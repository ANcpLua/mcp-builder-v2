// Tests for ci/weekly.mjs (pure core and telemetry sender). Run: node --test ci/weekly.test.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import {
    DEFAULT_MODEL, SERVICE, baselineFromEval, compare, evalCommand, evalMode, evalOutcome, otlpPayloads, parseArgs, parseHeaders,
    planPhases, releaseNews, renderSummary, scoresFromEval, sendTelemetry, verdict,
} from './weekly.mjs';

// Shape of `claude plugin eval --json` (trimmed to the fields weekly.mjs reads).
const EVAL = {
    costUsd: 0.81234, partial: false,
    cases: [
        { name: 'ts-build-server', aggregates: { score: 1, scoreWithout: 0 } },
        { name: 'py-build-server', aggregates: { score: 0.6666666, scoreWithout: 0.3333333 } },
        { name: 'unrelated-request', aggregates: { score: 1 } },
    ],
};
const pass = (id, leg = 'checks', hard = true) => ({ id, leg, hard, status: 'pass', ms: 1000, detail: [] });

test('parseArgs: defaults and flags', () => {
    assert.deepEqual(parseArgs([]), { model: DEFAULT_MODEL, canary: null, full: false, noModel: false, maxCostUsd: null, out: null, writeBaseline: null });
    const o = parseArgs(['--canary', '/x', '--model', 'm', '--full', '--max-cost-usd', '4', '--out', '/o']);
    assert.equal(o.canary, '/x'); assert.equal(o.model, 'm'); assert.equal(o.full, true); assert.equal(o.maxCostUsd, 4); assert.equal(o.out, '/o');
    assert.throws(() => parseArgs(['--full', '--no-model']), /contradict/);
    assert.throws(() => parseArgs(['--model']), /needs a value/);
    assert.throws(() => parseArgs(['--max-cost-usd', '-1']), /positive/);
    assert.throws(() => parseArgs(['--bogus']), /unknown argument/);
});

test('evalMode: full A/B in the first week of a month, cheap arm otherwise', () => {
    const day = d => new Date(Date.UTC(2026, 9, d));
    assert.equal(evalMode(parseArgs([]), day(3)).name, 'full');
    assert.deepEqual(evalMode(parseArgs([]), day(15)), { name: 'weekly', ablation: 'none', runs: 1, maxCostUsd: 3 });
    assert.deepEqual(evalMode(parseArgs(['--full']), day(15)), { name: 'full', ablation: 'with-without', runs: 3, maxCostUsd: 10 });
    assert.equal(evalMode(parseArgs(['--max-cost-usd', '1']), day(15)).maxCostUsd, 1);
    assert.equal(evalMode(parseArgs(['--no-model']), day(3)), null);
});

test('planPhases: hard checks first, canary only when asked, news last and advisory', () => {
    const without = planPhases({ skill: '/s', work: '/w', canary: null });
    const withCanary = planPhases({ skill: '/s', work: '/w', canary: '/c' });
    assert.equal(withCanary.length, without.length + 1);
    assert.equal(new Set(withCanary.map(p => p.id)).size, withCanary.length);
    const canary = withCanary.find(p => p.id === 'canary-precision');
    assert.equal(canary.hard, true); assert.match(canary.cmd, /check_v2\.mjs' '\/c'/);
    const last = withCanary.at(-1);
    assert.equal(last.id, 'release-news'); assert.equal(last.hard, false);
    assert.ok(withCanary.slice(0, -1).every(p => p.hard));
});

test('evalCommand: model pinned for runs and judge, tool grants last', () => {
    const argv = evalCommand({ root: '/r', out: '/o', model: 'claude-haiku-5-5', mode: { runs: 1, ablation: 'none', maxCostUsd: 3 } });
    assert.deepEqual(argv.slice(0, 4), ['claude', 'plugin', 'eval', '/r']);
    assert.equal(argv[argv.indexOf('--model') + 1], 'claude-haiku-5-5');
    assert.equal(argv[argv.indexOf('--judge-model') + 1], 'claude-haiku-5-5');
    assert.equal(argv[argv.indexOf('--ablation') + 1], 'none');
    assert.equal(argv[argv.indexOf('--threshold') + 1], '0');
    assert.ok(argv.indexOf('--allow-tools') > argv.indexOf('--report'));
});

test('releaseNews: NEW lines only, @types/node majors ignored', () => {
    const out = [
        'ok   npm  zod                              pinned ^4.6.5     latest 4.6.5',
        'NEW  npm  @types/node                      pinned ^22.19.0   latest 26.6.4',
        'NEW  npm  @modelcontextprotocol/inspector  pinned 2.9.0      latest 2.10.0',
    ].join('\n');
    assert.deepEqual(releaseNews(out), ['NEW npm @modelcontextprotocol/inspector pinned 2.9.0 latest 2.10.0']);
});

test('scoresFromEval, baseline and compare', () => {
    const scores = scoresFromEval(EVAL);
    assert.deepEqual(scores.cases['py-build-server'], { with: 0.67, without: 0.33 });
    assert.equal(scores.cases['unrelated-request'].without, null);
    assert.equal(scores.costUsd, 0.81);
    assert.ok(compare(scores, null).every(c => c.flag === 'no baseline'));
    const baseline = baselineFromEval({ cases: [
        { name: 'ts-build-server', aggregates: { score: 1 } },
        { name: 'py-build-server', aggregates: { score: 1 } },
        { name: 'unrelated-request', aggregates: { score: 1 } },
    ] }, 'm', '2026-10-01');
    const c = Object.fromEntries(compare(scores, baseline).map(x => [x.name, x]));
    assert.equal(c['ts-build-server'].flag, 'steady');
    assert.equal(c['py-build-server'].flag, 'DROP');
    assert.equal(c['py-build-server'].delta, -0.33);
});

test('evalOutcome: no JSON, no cases, partial and a sandbox problem all fail', () => {
    const ok = scoresFromEval(EVAL);
    assert.deepEqual(evalOutcome({ parsed: ok, problem: null, code: 0 }), { status: 'pass', reason: null });
    assert.match(evalOutcome({ parsed: null, problem: null, code: 1, timedOut: true }).reason, /no eval\.json \(exit 1, timed out\)/);
    assert.match(evalOutcome({ parsed: scoresFromEval({ cases: [] }), problem: null, code: 1 }).reason, /ran no cases/);
    assert.match(evalOutcome({ parsed: { ...ok, partial: true }, problem: null, code: 2 }).reason, /cost ceiling/);
    assert.deepEqual(evalOutcome({ parsed: ok, problem: 'bwrap missing', code: 0 }), { status: 'fail', reason: 'bwrap missing' });
});

test('verdict: RED for a hard failure, AMBER for news, eval trouble or a moved score, else GREEN', () => {
    const steady = { status: 'pass', comparisons: [{ flag: 'steady' }] };
    assert.equal(verdict([pass('a'), pass('b')], steady), 'GREEN');
    assert.equal(verdict([pass('a'), pass('b')], null), 'GREEN');
    assert.equal(verdict([pass('a'), { ...pass('b'), status: 'fail' }], steady), 'RED');
    assert.equal(verdict([pass('a'), { ...pass('n', 'news', false), status: 'notice' }], steady), 'AMBER');
    assert.equal(verdict([pass('a'), { ...pass('plugin-eval', 'eval', false), status: 'fail' }], { status: 'fail', comparisons: [] }), 'AMBER');
    assert.equal(verdict([pass('a')], { status: 'pass', comparisons: [{ flag: 'DROP' }] }), 'AMBER');
    assert.equal(verdict([pass('a')], { status: 'pass', comparisons: [{ flag: 'no baseline' }] }), 'GREEN');
});

test('renderSummary: verdict on the first line, failure output included', () => {
    const phases = [pass('a'), { ...pass('canary-precision', 'canary'), status: 'fail', detail: ['src/x.ts:3 E-TS-FOO'] }];
    const md = renderSummary({ date: '2026-10-12', verdict: 'RED', model: 'm', phases, evalRun: null, telemetry: 'off' });
    assert.match(md.split('\n')[0], /2026-10-12: RED$/);
    assert.match(md, /## canary-precision: FAIL/);
    assert.match(md, /src\/x\.ts:3 E-TS-FOO/);
    assert.match(md, /Not run \(--no-model\)/);
});

test('otlpPayloads: qyl CI convention (service prefix, session.id, ci.leg, error status)', () => {
    let n = 0;
    const rand = k => String(++n).padStart(k * 2, '0');
    const phases = [pass('drift-self-test'), { ...pass('canary-precision', 'canary'), status: 'fail' }, { ...pass('release-news', 'news', false), status: 'notice' }];
    const evalRun = { comparisons: [{ name: 'ts-build-server', with: 1, without: 0 }, { name: 'unrelated-request', with: 1, without: null }] };
    const { traces, metrics } = otlpPayloads({ service: SERVICE, version: '0.1.0', sessionId: 'sess-1', model: 'm', startNs: 1_000_000_000n, phases, evalRun, rand });
    assert.ok(SERVICE.startsWith('qyl-ci'));
    const rs = traces.resourceSpans[0];
    assert.deepEqual(rs.resource.attributes[0], { key: 'service.name', value: { stringValue: SERVICE } });
    const spans = rs.scopeSpans[0].spans;
    assert.equal(spans.length, 4);
    const get = (s, k) => s.attributes.find(a => a.key === k)?.value;
    for (const s of spans) {
        assert.deepEqual(get(s, 'session.id'), { stringValue: 'sess-1' });
        assert.ok(get(s, 'ci.leg').stringValue);
        assert.ok(BigInt(s.endTimeUnixNano) >= BigInt(s.startTimeUnixNano));
    }
    const byName = Object.fromEntries(spans.map(s => [s.name, s]));
    assert.equal(byName['canary-precision'].status.code, 2);
    assert.equal(byName['release-news'].status.code, 1);
    assert.equal(byName.weekly.status.code, 2);
    assert.equal(byName['drift-self-test'].parentSpanId, byName.weekly.spanId);
    const points = metrics.resourceMetrics[0].scopeMetrics[0].metrics[0].gauge.dataPoints;
    assert.equal(points.length, 3);
    assert.equal(otlpPayloads({ service: SERVICE, version: '0', sessionId: 's', model: 'm', startNs: 0n, phases, evalRun: null, rand }).metrics, null);
});

test('parseHeaders: OTEL_EXPORTER_OTLP_HEADERS format', () => {
    assert.deepEqual(parseHeaders('x-api-key=abc%3D,  other = 1 ,broken'), { 'x-api-key': 'abc=', other: '1' });
    assert.deepEqual(parseHeaders(undefined), {});
});

test('sendTelemetry: posts traces and metrics with the configured headers; off without an endpoint', async () => {
    assert.match(await sendTelemetry({ traces: {}, metrics: null }, {}), /^off/);
    const seen = [];
    const server = createServer((req, res) => {
        let body = '';
        req.on('data', d => (body += d));
        req.on('end', () => { seen.push({ url: req.url, key: req.headers['x-api-key'], body: JSON.parse(body) }); res.end('{}'); });
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    try {
        const base = `http://127.0.0.1:${server.address().port}/`;
        const result = await sendTelemetry({ traces: { resourceSpans: [] }, metrics: { resourceMetrics: [] } }, { QYL_OTLP_ENDPOINT: base, QYL_OTLP_HEADERS: 'x-api-key=k1' });
        assert.match(result, /traces 200, metrics 200/);
        assert.deepEqual(seen.map(s => [s.url, s.key]), [['/v1/traces', 'k1'], ['/v1/metrics', 'k1']]);
    } finally {
        server.close();
    }
});
