#!/usr/bin/env node
// verify_server — proves a running MCP server answers in BOTH protocol eras, black-box.
//
//   node verify_server.mjs [--cwd DIR] -- <command> [args...]                 local stdio:  -- npx tsx src/stdio.ts
//   node verify_server.mjs --url http://127.0.0.1:3000/mcp                     remote, already running
//   node verify_server.mjs --url http://127.0.0.1:3000/mcp [--cwd DIR] --start -- <command> [args...]
//                                                                             remote: start it, wait until it answers, verify, stop it
//   options: --skip-conformance  --with-caching  --json
//
// Checks, each GREEN or RED:
//   modern-era   Inspector CLI pinned to 2026-07-28 lists tools       <- the check v1 wiring fails
//   legacy-era   Inspector CLI in 2025 mode lists tools                <- what most hosts still use
//   schema       Inspector --strict tool-schema portability report (modern)
//   conformance  official suite, scenarios from conformance_scope.json (HTTP only)
// Tool pins come from ../pins.json. Requires Node >= 22.19 (Inspector 2.x).

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- functional core

export function parseArgs(argv) {
    const dash = argv.indexOf('--');
    const opts = dash >= 0 ? argv.slice(0, dash) : argv;
    const command = dash >= 0 ? argv.slice(dash + 1) : [];
    const val = flag => (opts.includes(flag) ? opts[opts.indexOf(flag) + 1] : undefined);
    return {
        url: val('--url'),
        cwd: val('--cwd'),
        command,
        start: opts.includes('--start'),
        skipConformance: opts.includes('--skip-conformance'),
        withCaching: opts.includes('--with-caching'),
        json: opts.includes('--json')
    };
}

export function inspectorConfig(target, era) {
    const base = target.url
        ? { type: 'streamable-http', url: target.url }
        : { command: target.command[0], args: target.command.slice(1), ...(target.cwd ? { cwd: target.cwd } : {}) };
    return { mcpServers: { target: { ...base, protocolEra: era } } };
}

export function parseToolList(stdout, stderr = '') {
    try {
        const data = JSON.parse(stdout);
        if (Array.isArray(data.tools)) return { ok: true, names: data.tools.map(t => t.name) };
    } catch {
        // fall through to the error line the Inspector prints on stderr
    }
    const errLine = [...stdout.split('\n'), ...stderr.split('\n')].find(l => l.trim().startsWith('{"error"'));
    const message = errLine ? (JSON.parse(errLine).error?.message ?? errLine) : stdout.trim() || '(no output)';
    return { ok: false, error: String(message).slice(0, 300) };
}

export function classifyChecks(checks, fixtureIds) {
    const fixture = new Set(fixtureIds);
    return {
        passed: checks.filter(c => c.status === 'SUCCESS').map(c => c.id),
        failed: checks.filter(c => c.status === 'FAILURE' && !fixture.has(c.id)).map(c => ({ id: c.id, why: c.errorMessage })),
        notApplicable: checks.filter(c => c.status !== 'SUCCESS' && fixture.has(c.id)).map(c => c.id),
        warnings: checks.filter(c => c.status === 'WARNING' && !fixture.has(c.id)).map(c => ({ id: c.id, why: c.errorMessage }))
    };
}

export const isLocalhost = url => /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\//.test(url);

export function nodeOk(version, min = '22.19.0') {
    const [a, b, c] = version.split('.').map(Number);
    const [x, y, z] = min.split('.').map(Number);
    return a > x || (a === x && (b > y || (b === y && c >= z)));
}

export function report(results) {
    const lines = results.map(r => `${r.ok ? 'GREEN' : 'RED  '}  ${r.check.padEnd(28)} ${r.detail}`);
    const red = results.filter(r => !r.ok).length;
    lines.push('', red === 0 ? 'verify_server: GREEN — the server answers in both eras.' : `verify_server: RED — ${red} check(s) failed.`);
    return lines.join('\n');
}

// ---------------------------------------------------------------- imperative shell

function run(cmd, args, opts = {}) {
    const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 180_000, env: { ...process.env, MCP_INSPECTOR_SECRET_STORE: 'memory' }, ...opts });
    return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function inspector(pins, dir, target, era, extra) {
    const cfg = join(dir, `inspector-${era}.json`);
    writeFileSync(cfg, JSON.stringify(inspectorConfig(target, era), null, 2));
    return run('npx', ['-y', pins.tools.inspector, '--cli', '--config', cfg, '--server', 'target', '--method', 'tools/list', ...extra]);
}

function eraCheck(pins, dir, target, era) {
    const r = inspector(pins, dir, target, era, []);
    const parsed = parseToolList(r.stdout, r.stderr);
    return parsed.ok
        ? { check: `${era}-era tools/list`, ok: parsed.names.length > 0, detail: `${parsed.names.length} tool(s): ${parsed.names.join(', ')}` }
        : { check: `${era}-era tools/list`, ok: false, detail: parsed.error };
}

function schemaCheck(pins, dir, target) {
    const r = inspector(pins, dir, target, 'modern', ['--strict']);
    const note = r.stderr.split('\n').filter(l => /portab|schema|issue/i.test(l)).slice(0, 6).join(' | ');
    return { check: 'tool-schema portability', ok: r.code === 0, detail: r.code === 0 ? 'no error-severity issues' : `exit ${r.code}: ${note}` };
}

function conformance(pins, dir, url, scope, withCaching) {
    const scenarios = [...scope.scenarios, ...(isLocalhost(url) ? scope.localhost_only_scenarios : []), ...(withCaching ? ['caching'] : [])];
    return scenarios.map(scenario => {
        const out = join(dir, `conf-${scenario}`);
        run('npx', ['-y', pins.tools.conformance, 'server', '--url', url, '--scenario', scenario, '--spec-version', pins.spec.current, '-o', out]);
        const sub = (() => {
            try {
                return readdirSync(out).map(d => join(out, d)).find(d => statSync(d).isDirectory());
            } catch {
                return undefined;
            }
        })();
        if (!sub) return { check: `conformance ${scenario}`, ok: false, detail: 'suite produced no results (is the server running?)' };
        const c = classifyChecks(JSON.parse(readFileSync(join(sub, 'checks.json'), 'utf8')), scope.fixture_checks);
        const extras = [c.notApplicable.length ? `${c.notApplicable.length} n/a (need SDK fixtures)` : '', c.warnings.length ? `${c.warnings.length} SHOULD-warning(s): ${c.warnings.map(w => w.id).join(', ')}` : ''].filter(Boolean).join('; ');
        const failed = c.failed.map(f => `${f.id}: ${String(f.why).slice(0, 140)}`).join(' | ');
        return { check: `conformance ${scenario}`, ok: c.failed.length === 0, detail: `${c.passed.length} passed${extras ? `; ${extras}` : ''}${failed ? `; FAILED ${failed}` : ''}` };
    });
}

async function startServer(args) {
    const child = spawn(args.command[0], args.command.slice(1), { cwd: args.cwd, detached: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', d => (stderr = (stderr + d).slice(-2000)));
    const stop = () => {
        try {
            process.kill(-child.pid, 'SIGTERM');
        } catch {
            // already gone
        }
    };
    const body = JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'server/discover', params: {} });
    for (let i = 0; i < 60; i++) {
        if (child.exitCode !== null) return { stop, error: `server exited with code ${child.exitCode}: ${stderr.trim().slice(-400)}` };
        try {
            await fetch(args.url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body });
            return { stop };
        } catch {
            await new Promise(r => setTimeout(r, 500));
        }
    }
    stop();
    return { stop, error: `no answer from ${args.url} after 30s: ${stderr.trim().slice(-400)}` };
}

async function main(argv) {
    const args = parseArgs(argv);
    if (!args.url && args.command.length === 0) {
        console.error('usage: node verify_server.mjs [--cwd DIR] -- <cmd...> | --url <http://host/mcp> [--start -- <cmd...>]');
        return 2;
    }
    if (args.url && args.start && args.command.length === 0) {
        console.error('--start needs the server command after --');
        return 2;
    }
    if (!nodeOk(process.versions.node)) {
        console.error(`verify_server needs Node >= 22.19.0 for the Inspector (found ${process.versions.node}).`);
        return 2;
    }
    const pins = JSON.parse(readFileSync(join(HERE, '..', 'pins.json'), 'utf8'));
    const scope = JSON.parse(readFileSync(join(HERE, 'conformance_scope.json'), 'utf8'));
    const target = args.url ? { url: args.url } : { command: args.command, cwd: args.cwd };
    const server = args.url && args.start ? await startServer(args) : null;
    if (server?.error) {
        console.log(report([{ check: 'start server', ok: false, detail: server.error }]));
        return 1;
    }
    const dir = mkdtempSync(join(tmpdir(), 'verify-mcp-'));
    try {
        const modern = eraCheck(pins, dir, target, 'modern');
        const legacy = eraCheck(pins, dir, target, 'legacy');
        const schema = modern.ok ? schemaCheck(pins, dir, target) : { check: 'tool-schema portability', ok: false, detail: 'skipped: the modern era did not connect (see drift.md, "the wiring")' };
        const results = [modern, legacy, schema];
        if (args.url && !args.skipConformance) results.push(...conformance(pins, dir, args.url, scope, args.withCaching));
        console.log(args.json ? JSON.stringify(results, null, 2) : report(results));
        return results.every(r => r.ok) ? 0 : 1;
    } finally {
        server?.stop();
        rmSync(dir, { recursive: true, force: true });
    }
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) process.exit(await main(process.argv.slice(2)));
