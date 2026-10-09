#!/usr/bin/env node
// Weekly regression check for the mcp-builder-v2 plugin. Node >= 20, no dependencies.
//
//   node ci/weekly.mjs [--canary <dir>] [--model <id>] [--full | --no-model] [--max-cost-usd <n>] [--out <dir>]
//   node ci/weekly.mjs --write-baseline <eval.json> [--model <id>]
//
// Phases, cheapest first:
//   checks  zero model tokens: drift-rule self-test, pins, both templates in both eras, verify_server
//   canary  check_v2 on an independently written v2 server (--canary); any error-level finding is a false positive
//   news    newer SDK/tool releases than pins.json (advisory)
//   eval    `claude plugin eval` pinned to --model: with-plugin arm, 1 run per case; in the first 7 days of a
//           month (or with --full) both arms, 3 runs per case
//
// Verdict: RED when a checks/canary phase fails. AMBER for release news, an eval score that moved more than 0.25
// from the committed baseline, or an eval that did not complete. GREEN otherwise.
// Writes <out>/summary.md and <out>/result.json; the last stdout line is "DONE <verdict> <summary path>".
// Exit status: 1 for RED, else 0.
//
// Optional telemetry for a qyl collector: set QYL_OTLP_ENDPOINT (OTLP/HTTP base URL) and, if the collector needs
// a key, QYL_OTLP_HEADERS ("name=value,name2=value2"). Each phase becomes one span (named after the phase, with a
// `ci.leg` attribute, error status when it failed) under a service named qyl-ci-mcp-builder-v2, so qyl's `ci_log`
// tool lists the run; eval scores are also sent as the gauge mcp_builder_v2.eval.score.

import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, createWriteStream } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_MODEL = 'claude-haiku-5-5';
export const SERVICE = 'qyl-ci-mcp-builder-v2';
export const TOLERANCE = 0.25;
const MINUTE = 60_000;

// ------------------------------------------------------------------ functional core (pure)

export function parseArgs(argv) {
    const opts = { model: DEFAULT_MODEL, canary: null, full: false, noModel: false, maxCostUsd: null, out: null, writeBaseline: null };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const value = () => {
            const v = argv[++i];
            if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
            return v;
        };
        if (a === '--model') opts.model = value();
        else if (a === '--canary') opts.canary = value();
        else if (a === '--full') opts.full = true;
        else if (a === '--no-model') opts.noModel = true;
        else if (a === '--max-cost-usd') opts.maxCostUsd = Number(value());
        else if (a === '--out') opts.out = value();
        else if (a === '--write-baseline') opts.writeBaseline = value();
        else throw new Error(`unknown argument ${a}`);
    }
    if (opts.full && opts.noModel) throw new Error('--full and --no-model contradict each other');
    if (opts.maxCostUsd !== null && !(opts.maxCostUsd > 0)) throw new Error('--max-cost-usd needs a positive number');
    return opts;
}

/** Full A/B in the first week of each month or on request; otherwise the cheap with-plugin arm. */
export function evalMode(opts, today) {
    if (opts.noModel) return null;
    const full = opts.full || today.getUTCDate() <= 7;
    return full
        ? { name: 'full', ablation: 'with-without', runs: 3, maxCostUsd: opts.maxCostUsd ?? 10 }
        : { name: 'weekly', ablation: 'none', runs: 1, maxCostUsd: opts.maxCostUsd ?? 3 };
}

/** The phase list. Paths are absolute; `work` holds disposable template copies. */
export function planPhases({ skill, work, canary }) {
    const node = (script, args) => `node ${q(join(skill, 'scripts', script))} ${args}`;
    const ts = join(work, 'typescript');
    const py = join(work, 'python');
    const phases = [
        { id: 'drift-self-test', leg: 'checks', hard: true, cmd: node('check_v2.mjs', '--self-test') },
        { id: 'pins-agree', leg: 'checks', hard: true, cmd: node('check_pins.mjs', '') },
        { id: 'templates-drift-free', leg: 'checks', hard: true, cmd: node('check_v2.mjs', q(join(skill, 'templates'))) },
        { id: 'ts-template-tests', leg: 'checks', hard: true, cwd: ts, timeoutMs: 15 * MINUTE,
          cmd: 'npm install --no-audit --no-fund --loglevel=error && npm run typecheck && npm test' },
        { id: 'ts-template-verify', leg: 'checks', hard: true, timeoutMs: 10 * MINUTE,
          cmd: node('verify_server.mjs', `--cwd ${q(ts)} -- npx tsx src/stdio.ts`) },
        { id: 'py-template-tests', leg: 'checks', hard: true, cwd: py, timeoutMs: 15 * MINUTE,
          cmd: 'python3 -m venv .venv && .venv/bin/pip install -q -e ".[dev]" && .venv/bin/pytest -q' },
        { id: 'py-template-verify', leg: 'checks', hard: true, timeoutMs: 10 * MINUTE,
          cmd: node('verify_server.mjs', `--url http://127.0.0.1:8000/mcp --cwd ${q(py)} --start -- .venv/bin/python -m catalog_mcp http`) },
    ];
    if (canary) phases.push({ id: 'canary-precision', leg: 'canary', hard: true, cmd: node('check_v2.mjs', q(canary)) });
    phases.push({ id: 'release-news', leg: 'news', hard: false, kind: 'news', cmd: node('check_pins.mjs', '--online') });
    return phases;
}

export function evalCommand({ root, out, model, mode }) {
    return [
        'claude', 'plugin', 'eval', root,
        '--scaffold', '--trust-plugin', '--no-publish', '--threshold', '0', '-j', '2',
        '--model', model, '--judge-model', model,
        '--runs', String(mode.runs), '--ablation', mode.ablation, '--max-cost-usd', String(mode.maxCostUsd),
        '--json', join(out, 'eval.json'), '--report', join(out, 'eval-report.html'),
        '--allow-tools', 'Bash', 'Write', 'Edit',
        'WebFetch(domain:registry.npmjs.org)', 'WebFetch(domain:pypi.org)', 'WebFetch(domain:files.pythonhosted.org)',
    ];
}

/**
 * Lines of `check_pins --online` that announce a newer release. `@types/node` is left out: its major follows the
 * Node runtime the templates target (22), so a newer major there is expected, not news.
 */
export function releaseNews(output) {
    return output.split('\n')
        .filter(l => l.startsWith('NEW ') && !/\s@types\/node\s/.test(l))
        .map(l => l.replace(/\s+/g, ' ').trim());
}

/** Per-case scores from `claude plugin eval --json` output. */
export function scoresFromEval(result) {
    const cases = {};
    for (const c of result?.cases ?? []) {
        const a = c.aggregates ?? {};
        cases[c.name] = { with: num(a.score), without: num(a.scoreWithout) };
    }
    return { cases, costUsd: num(result?.costUsd), partial: result?.partial === true };
}

/** Did the eval produce usable scores? `parsed` is scoresFromEval output or null when no JSON was written. */
export function evalOutcome({ parsed, problem, code, timedOut }) {
    if (problem) return { status: 'fail', reason: problem };
    if (!parsed) return { status: 'fail', reason: `no eval.json (exit ${code}${timedOut ? ', timed out' : ''}); see logs/eval.log` };
    if (!Object.keys(parsed.cases).length) return { status: 'fail', reason: `the eval ran no cases (exit ${code}); see logs/eval.log` };
    if (parsed.partial) return { status: 'fail', reason: 'cost ceiling hit, partial results' };
    return { status: 'pass', reason: null };
}

export function baselineFromEval(result, model, recorded) {
    return { model, recorded, source: 'claude plugin eval --json', cases: scoresFromEval(result).cases };
}

/** Compare each case's with-plugin score to the committed baseline. */
export function compare(scores, baseline, tolerance = TOLERANCE) {
    return Object.entries(scores.cases).map(([name, s]) => {
        const base = baseline?.cases?.[name]?.with ?? null;
        const delta = base === null || s.with === null ? null : round(s.with - base);
        const flag = base === null ? 'no baseline' : delta < -tolerance ? 'DROP' : delta > tolerance ? 'RISE' : 'steady';
        return { name, with: s.with, without: s.without, base, delta, flag };
    });
}

export function verdict(phases, evalRun) {
    if (phases.some(p => p.hard && p.status === 'fail')) return 'RED';
    if (phases.some(p => p.status === 'notice' || (!p.hard && p.status === 'fail'))) return 'AMBER';
    if (evalRun && (evalRun.status !== 'pass' || evalRun.comparisons.some(c => c.flag === 'DROP' || c.flag === 'RISE'))) return 'AMBER';
    return 'GREEN';
}

export function renderSummary({ date, verdict: v, model, phases, evalRun, telemetry }) {
    const lines = [`# mcp-builder-v2 weekly check, ${date}: ${v}`, ''];
    lines.push('| Phase | Leg | Result | Time |', '|---|---|---|---|');
    for (const p of phases) lines.push(`| ${p.id} | ${p.leg} | ${p.status.toUpperCase()}${p.hard ? '' : ' (advisory)'} | ${secs(p.ms)} |`);
    const failed = phases.filter(p => p.status === 'fail' || p.status === 'notice');
    for (const p of failed) {
        lines.push('', `## ${p.id}: ${p.status.toUpperCase()}`, '', '```text', ...(p.detail ?? []).slice(-20), '```');
    }
    lines.push('', `## Eval (${model})`, '');
    if (!evalRun) lines.push('Not run (--no-model).');
    else if (evalRun.status !== 'pass') lines.push(`Did not complete: ${evalRun.reason}`);
    if (evalRun?.comparisons?.length) {
        lines.push(`Mode: ${evalRun.mode.name} (${evalRun.mode.runs} run(s) per case, ablation ${evalRun.mode.ablation}). ` +
            `Cost reported by the CLI: $${evalRun.costUsd ?? '?'}${evalRun.partial ? ' (partial: cost ceiling hit)' : ''}.`, '');
        lines.push('| Case | With plugin | Without | Baseline (with) | Change |', '|---|---|---|---|---|');
        for (const c of evalRun.comparisons) {
            lines.push(`| ${c.name} | ${fmt(c.with)} | ${fmt(c.without)} | ${fmt(c.base)} | ${c.delta === null ? c.flag : `${c.delta > 0 ? '+' : ''}${c.delta} ${c.flag}`} |`);
        }
        if (evalRun.comparisons.every(c => c.base === null)) {
            lines.push('', 'No baseline for this model yet. After reviewing this run, adopt it with',
                '`node ci/weekly.mjs --write-baseline <out>/eval.json --model <model>` and commit `ci/baseline/`.');
        }
        if (evalRun.mode.runs === 1) lines.push('', 'One run per case: a single change can be chance. Confirm a DROP with `--full` before acting on it.');
    }
    lines.push('', `Telemetry: ${telemetry}`);
    return lines.join('\n') + '\n';
}

/** OTLP/JSON payloads following qyl's CI convention (see qyl.mcp server/src/ci.ts). */
export function otlpPayloads({ service, version, sessionId, model, startNs, phases, evalRun, rand = hex }) {
    const traceId = rand(16);
    const rootId = rand(8);
    const attr = (key, v) => ({ key, value: typeof v === 'number' ? { doubleValue: v } : typeof v === 'boolean' ? { boolValue: v } : { stringValue: String(v) } });
    const status = s => (s === 'fail' ? { code: 2, message: 'failed' } : { code: 1 });
    let cursor = startNs;
    const spans = phases.map(p => {
        const start = cursor;
        cursor += BigInt(Math.max(0, Math.round(p.ms ?? 0))) * 1_000_000n;
        return {
            traceId, spanId: rand(8), parentSpanId: rootId, name: p.id, kind: 1,
            startTimeUnixNano: String(start), endTimeUnixNano: String(cursor),
            attributes: [attr('ci.leg', p.leg), attr('session.id', sessionId), attr('ci.phase.result', p.status), attr('ci.phase.hard', p.hard)],
            status: status(p.status),
        };
    });
    const anyFailed = phases.some(p => p.status === 'fail');
    spans.unshift({
        traceId, spanId: rootId, name: 'weekly', kind: 1,
        startTimeUnixNano: String(startNs), endTimeUnixNano: String(cursor),
        attributes: [attr('ci.leg', 'run'), attr('session.id', sessionId), attr('eval.model', model)],
        status: status(anyFailed ? 'fail' : 'pass'),
    });
    const resource = { attributes: [attr('service.name', service), attr('service.version', version)] };
    const traces = { resourceSpans: [{ resource, scopeSpans: [{ scope: { name: 'mcp-builder-v2-weekly' }, spans }] }] };
    const points = [];
    for (const c of evalRun?.comparisons ?? []) {
        for (const arm of ['with', 'without']) {
            if (c[arm] === null) continue;
            points.push({ timeUnixNano: String(cursor), asDouble: c[arm],
                attributes: [attr('eval.case', c.name), attr('eval.arm', arm), attr('eval.model', model), attr('session.id', sessionId)] });
        }
    }
    const metrics = points.length
        ? { resourceMetrics: [{ resource, scopeMetrics: [{ scope: { name: 'mcp-builder-v2-weekly' },
            metrics: [{ name: 'mcp_builder_v2.eval.score', unit: '1', gauge: { dataPoints: points } }] }] }] }
        : null;
    return { traces, metrics };
}

export function parseHeaders(text) {
    const headers = {};
    for (const part of (text ?? '').split(',')) {
        const i = part.indexOf('=');
        if (i > 0) headers[decodeURIComponent(part.slice(0, i).trim())] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return headers;
}

function q(s) { return `'${String(s).replaceAll("'", `'\\''`)}'`; }
function num(v) { return typeof v === 'number' && Number.isFinite(v) ? round(v) : null; }
function round(v) { return Math.round(v * 100) / 100; }
function fmt(v) { return v === null || v === undefined ? '-' : v.toFixed(2); }
function secs(ms) { return ms === undefined ? '-' : `${Math.round(ms / 1000)} s`; }
function hex(n) { return randomBytes(n).toString('hex'); }

// ------------------------------------------------------------------ imperative shell

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN = join(ROOT, 'plugins', 'mcp-builder-v2');
const SKILL = join(PLUGIN, 'skills', 'mcp-builder-v2');

function log(msg) { console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`); }

function runCommand(argvOrCmd, { cwd = ROOT, timeoutMs = 5 * MINUTE, logFile }) {
    return new Promise(done => {
        const argv = Array.isArray(argvOrCmd) ? argvOrCmd : ['bash', '-c', argvOrCmd];
        const started = Date.now();
        const child = spawn(argv[0], argv.slice(1), { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
        const file = createWriteStream(logFile);
        let tail = '';
        let timedOut = false;
        const take = d => { file.write(d); tail = (tail + d).slice(-20_000); };
        child.stdout.on('data', take);
        child.stderr.on('data', take);
        const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, timeoutMs);
        child.on('close', (code, signal) => {
            clearTimeout(timer);
            file.end();
            done({ code: code ?? 1, signal, ms: Date.now() - started, tail, timedOut });
        });
        child.on('error', e => { clearTimeout(timer); file.end(); done({ code: 127, ms: Date.now() - started, tail: String(e), timedOut: false }); });
    });
}

function ensureSandboxTools(logFile) {
    const have = t => spawnSync('bash', ['-c', `command -v ${t}`]).status === 0;
    if (have('bwrap') && have('socat')) return null;
    if (process.getuid?.() !== 0) return 'bubblewrap/socat missing and not root: install them first';
    const r = spawnSync('bash', ['-c', 'apt-get update -qq && apt-get install -y -qq bubblewrap socat'], { encoding: 'utf8' });
    writeFileSync(logFile, (r.stdout ?? '') + (r.stderr ?? ''));
    return r.status === 0 ? null : 'apt-get install bubblewrap socat failed';
}

export async function sendTelemetry(payloads, env = process.env) {
    const base = env.QYL_OTLP_ENDPOINT || env.OTEL_EXPORTER_OTLP_ENDPOINT;
    if (!base) return 'off (set QYL_OTLP_ENDPOINT to send this run to a qyl collector)';
    const headers = { 'content-type': 'application/json', ...parseHeaders(env.QYL_OTLP_HEADERS || env.OTEL_EXPORTER_OTLP_HEADERS) };
    const sent = [];
    for (const [path, body] of [['traces', payloads.traces], ['metrics', payloads.metrics]]) {
        if (!body) continue;
        try {
            const r = await fetch(`${base.replace(/\/$/, '')}/v1/${path}`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
            sent.push(`${path} ${r.status}`);
        } catch (e) {
            sent.push(`${path} failed (${e.cause?.code ?? e.name})`);
        }
    }
    return `${sent.join(', ')} -> ${base} as ${SERVICE}`;
}

async function main(argv) {
    const opts = parseArgs(argv);
    const today = new Date();
    if (opts.writeBaseline) {
        const result = JSON.parse(readFileSync(opts.writeBaseline, 'utf8'));
        const file = join(ROOT, 'ci', 'baseline', `${opts.model}.json`);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, JSON.stringify(baselineFromEval(result, opts.model, today.toISOString().slice(0, 10)), null, 2) + '\n');
        console.log(`wrote ${file}`);
        return 0;
    }
    const out = resolve(opts.out ?? join(ROOT, 'ci', 'results', today.toISOString().slice(0, 10)));
    const work = join(out, 'work');
    mkdirSync(join(out, 'logs'), { recursive: true });
    for (const lang of ['typescript', 'python']) {
        cpSync(join(SKILL, 'templates', lang), join(work, lang), { recursive: true, filter: s => !/(node_modules|\.venv|__pycache__|\.egg-info)/.test(s) });
    }
    const startNs = BigInt(Date.now()) * 1_000_000n;
    const sessionId = `mcp-builder-v2-weekly-${today.toISOString().slice(0, 10)}-${hex(3)}`;
    const results = [];
    for (const spec of planPhases({ skill: SKILL, work, canary: opts.canary && resolve(opts.canary) })) {
        const r = await runCommand(spec.cmd, { cwd: spec.cwd ?? ROOT, timeoutMs: spec.timeoutMs ?? 5 * MINUTE, logFile: join(out, 'logs', `${spec.id}.log`) });
        let status = r.code === 0 ? 'pass' : 'fail';
        let detail = r.tail.trimEnd().split('\n');
        if (spec.kind === 'news') {
            const news = releaseNews(r.tail);
            status = news.length || r.code !== 0 ? 'notice' : 'pass';
            detail = news.length ? news : detail;
        }
        if (r.timedOut) detail.push(`(killed after ${secs(spec.timeoutMs ?? 5 * MINUTE)})`);
        results.push({ id: spec.id, leg: spec.leg, hard: spec.hard, status, ms: r.ms, detail });
        log(`${spec.id.padEnd(22)} ${status.toUpperCase()} (${secs(r.ms)})`);
    }

    let evalRun = null;
    const mode = evalMode(opts, today);
    if (mode) {
        const problem = ensureSandboxTools(join(out, 'logs', 'sandbox-tools.log'));
        const started = Date.now();
        const jsonFile = join(out, 'eval.json');
        rmSync(jsonFile, { force: true });
        let r = { code: 1, tail: problem ?? '' };
        if (!problem) {
            log(`eval: ${mode.name}, ${opts.model}, ${mode.runs} run(s) per case, cost ceiling $${mode.maxCostUsd}`);
            r = await runCommand(evalCommand({ root: PLUGIN, out, model: opts.model, mode }), { timeoutMs: 75 * MINUTE, logFile: join(out, 'logs', 'eval.log') });
        }
        const parsed = existsSync(jsonFile) ? scoresFromEval(JSON.parse(readFileSync(jsonFile, 'utf8'))) : null;
        const baselineFile = join(ROOT, 'ci', 'baseline', `${opts.model}.json`);
        const baseline = existsSync(baselineFile) ? JSON.parse(readFileSync(baselineFile, 'utf8')) : null;
        evalRun = {
            mode,
            ...evalOutcome({ parsed, problem, code: r.code, timedOut: r.timedOut }),
            costUsd: parsed?.costUsd ?? null,
            partial: parsed?.partial ?? false,
            comparisons: parsed ? compare(parsed, baseline) : [],
        };
        results.push({ id: 'plugin-eval', leg: 'eval', hard: false, status: evalRun.status, ms: Date.now() - started,
            detail: evalRun.status === 'pass' ? [] : [evalRun.reason, ...r.tail.trimEnd().split('\n').slice(-15)] });
        log(`plugin-eval            ${evalRun.status.toUpperCase()} (${secs(Date.now() - started)})`);
    }

    const v = verdict(results, evalRun);
    const version = JSON.parse(readFileSync(join(PLUGIN, '.claude-plugin', 'plugin.json'), 'utf8')).version;
    const telemetry = await sendTelemetry(otlpPayloads({ service: SERVICE, version, sessionId, model: opts.model, startNs, phases: results, evalRun }));
    const summary = renderSummary({ date: today.toISOString().slice(0, 10), verdict: v, model: opts.model, phases: results, evalRun, telemetry });
    writeFileSync(join(out, 'summary.md'), summary);
    writeFileSync(join(out, 'result.json'), JSON.stringify({ verdict: v, sessionId, model: opts.model, phases: results, eval: evalRun }, null, 2) + '\n');
    console.log(`DONE ${v} ${join(out, 'summary.md')}`);
    return v === 'RED' ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main(process.argv.slice(2)).then(code => process.exit(code), e => { console.error(String(e?.stack ?? e)); console.log('DONE RED (crashed)'); process.exit(1); });
}
