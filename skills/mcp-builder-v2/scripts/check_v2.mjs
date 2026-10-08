#!/usr/bin/env node
// check_v2 — finds v1 fingerprints (training-data drift) in an MCP server project.
//
//   node check_v2.mjs <project-dir> [--json]     exit 1 if any error-severity finding
//   node check_v2.mjs --self-test                prove every rule matches its bad example and misses its good one
//   node check_v2.mjs --rules                    print the rule catalogue (id, v1 habit, v2 form) as Markdown
//
// Rules are data (drift_rules.json). This file is a functional core (pure: text in, findings out)
// and a thin imperative shell (walk the tree, print, exit). Node >= 20, no dependencies.
// Suppress one finding with a comment on the same or previous line:  mcp-v2-allow RULE-ID

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKIP_DIRS = new Set(['node_modules', '.git', '.venv', 'venv', 'env', 'dist', 'build', '__pycache__', '.mypy_cache', '.pytest_cache', '.tox', '.next', 'coverage', 'out']);
const COMMENT_PREFIX = { ts: ['//', '*', '/*'], py: ['#'] };

// ---------------------------------------------------------------- functional core

export function loadRules(text) {
    const data = JSON.parse(text);
    const compile = r => ({
        ...r,
        re: new RegExp(r.pattern, r.scope === 'file' ? 'g' : 'gm'),
        requires: r.requiresInFile ? new RegExp(r.requiresInFile, 'm') : null,
        unless: r.unlessInFile ? new RegExp(r.unlessInFile, 'm') : null
    });
    const markers = Object.fromEntries(Object.entries(data.markers ?? {}).map(([lang, m]) => [lang, { re: new RegExp(m.pattern, 'm'), example: m.example }]));
    return { languages: data.languages, markers, rules: data.rules.map(compile), project: data.project, manifests: data.manifests };
}

/** Pure: project facts that some rules depend on. Unknown counts as risky. */
export function projectFacts(files) {
    const floors = [];
    for (const f of files.filter(x => x.kind === 'package.json')) {
        try {
            const pkg = JSON.parse(f.text);
            const zod = { ...pkg.peerDependencies, ...pkg.devDependencies, ...pkg.dependencies }.zod;
            if (zod !== undefined) floors.push(floorOf(zod));
        } catch {
            // unreadable manifest: says nothing
        }
    }
    const below = floors.some(v => v === null || v[0] < 4 || (v[0] === 4 && v[1] < 2));
    return { 'zod-below-4.2-or-unknown': floors.length === 0 || below };
}

export function langOf(path, languages) {
    const ext = extname(path);
    return Object.keys(languages).find(lang => languages[lang].includes(ext)) ?? null;
}

const isTestPath = path => /(^|[/\\])(tests?|__tests__|spec)([/\\])|[._-](test|spec)\.[cm]?[jt]sx?$|(^|[/\\])test_[^/\\]*\.py$|_test\.py$/.test(path);

function lineAt(text, index) {
    let line = 1;
    for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
    return line;
}

function isCommentLine(line, lang) {
    const t = line.trimStart();
    return (COMMENT_PREFIX[lang] ?? []).some(p => t.startsWith(p));
}

/** Pure: 1-based line numbers inside Python triple-quoted strings (docstrings are prose, not code). */
export function docstringLines(lines, lang) {
    const inside = new Set();
    if (lang !== 'py') return inside;
    let open = null;
    lines.forEach((line, i) => {
        const quotes = [...line.matchAll(/"""|'''/g)].map(m => m[0]);
        if (open) inside.add(i + 1);
        for (const q of quotes) {
            if (open === null) {
                open = q;
                inside.add(i + 1);
            } else if (q === open) {
                open = null;
            }
        }
    });
    return inside;
}

function suppressed(lines, lineNo, id) {
    const near = [lines[lineNo - 1] ?? '', lines[lineNo - 2] ?? ''];
    return near.some(l => l.includes(`mcp-v2-allow ${id}`) || l.includes('mcp-v2-allow ALL'));
}

/** Pure: findings for one source file. Code rules only look at files that import the MCP SDK. */
export function scanSource(path, text, lang, rules, markers = {}, facts = {}) {
    const lines = text.split('\n');
    const findings = [];
    const importsSdk = markers[lang] ? markers[lang].re.test(text) : true;
    const prose = docstringLines(lines, lang);
    for (const rule of rules) {
        if (rule.lang !== lang && rule.lang !== 'any') continue;
        if (!rule.anyFile && !importsSdk) continue;
        if (rule.when && facts[rule.when] === false) continue;
        if (rule.requires && !rule.requires.test(text)) continue;
        if (rule.unless && rule.unless.test(text)) continue;
        rule.re.lastIndex = 0;
        for (const m of text.matchAll(rule.re)) {
            const line = lineAt(text, m.index);
            if (isCommentLine(lines[line - 1] ?? '', lang) || prose.has(line)) continue;
            if (suppressed(lines, line, rule.id)) continue;
            findings.push(finding(rule, path, line, lines[line - 1]));
            if (rule.scope === 'file') break;
        }
    }
    return findings;
}

function finding(rule, path, line, source = '') {
    return { id: rule.id, severity: rule.severity, silent: Boolean(rule.silent), path, line, says: rule.says, fix: rule.fix, source: source.trim().slice(0, 160) };
}

/** Pure: lowest version a range string admits, as [major, minor]. "^3.25 || ^4" -> [3, 25]; "^4.2.0" -> [4, 2]. */
export function floorOf(range) {
    const versions = [...String(range).matchAll(/(\d+)(?:\.(\d+))?(?:\.\d+)?/g)].map(m => [Number(m[1]), Number(m[2] ?? 0)]);
    if (versions.length === 0) return null;
    return versions.reduce((lo, v) => (v[0] < lo[0] || (v[0] === lo[0] && v[1] < lo[1]) ? v : lo));
}

/** Pure: package.json findings. */
export function scanPackageJson(path, text, manifestRules) {
    const byId = Object.fromEntries(manifestRules.map(r => [r.id, r]));
    let pkg;
    try {
        pkg = JSON.parse(text);
    } catch {
        return [];
    }
    const deps = { ...pkg.peerDependencies, ...pkg.devDependencies, ...pkg.dependencies };
    const out = [];
    if ('@modelcontextprotocol/sdk' in deps) out.push(finding(byId['M-PKG-SDK-V1'], path, 1, `"@modelcontextprotocol/sdk": "${deps['@modelcontextprotocol/sdk']}"`));
    if ('@modelcontextprotocol/server-legacy' in deps) out.push(finding(byId['M-PKG-SERVER-LEGACY'], path, 1, `"@modelcontextprotocol/server-legacy"`));
    const usesMcp = Object.keys(deps).some(d => d.startsWith('@modelcontextprotocol/'));
    if (usesMcp && 'zod' in deps) {
        const floor = floorOf(deps.zod);
        if (floor && (floor[0] < 4 || (floor[0] === 4 && floor[1] < 2))) out.push(finding(byId['M-PKG-ZOD'], path, 1, `"zod": "${deps.zod}"`));
    }
    return out;
}

/** Pure: the version specifier attached to an `mcp` requirement, or null if none in this text. */
export function mcpRequirements(text) {
    const specs = [];
    const re = /(?:^|["'\s,[])mcp(?:\[[^\]]*\])?\s*((?:[<>=!~]=?\s*[\w.*]+\s*,?\s*)*)(?=["'\s#;]|$)/gm;
    for (const m of text.matchAll(re)) specs.push({ spec: m[1].trim(), index: m.index + m[0].indexOf('mcp') });
    return specs;
}

/** Pure: is this specifier bounded to the 2.x line? */
export function boundedToV2(spec) {
    const clauses = spec.split(',').map(s => s.trim()).filter(Boolean);
    const num = s => Number((s.match(/(\d+)/) ?? [])[1]);
    const lower = clauses.find(c => /^(>=|==|~=|>)/.test(c));
    const upper = clauses.find(c => /^<=?/.test(c));
    if (lower?.startsWith('==')) return num(lower) === 2;
    return lower !== undefined && num(lower) >= 2 && upper !== undefined && num(upper) <= 3 && num(upper) > 2;
}

/** Pure: pyproject.toml / requirements*.txt findings. */
export function scanPythonManifest(path, text, manifestRules) {
    const byId = Object.fromEntries(manifestRules.map(r => [r.id, r]));
    const out = [];
    for (const { spec, index } of mcpRequirements(text)) {
        const line = lineAt(text, index);
        const src = text.split('\n')[line - 1] ?? '';
        if (/^\s*(name|\[)/.test(src)) continue;
        if (spec === '') out.push(finding(byId['M-PY-MCP-UNPINNED'], path, line, src));
        else if (!boundedToV2(spec)) out.push(finding(byId['M-PY-MCP-RANGE'], path, line, src));
    }
    if (/["'\s]httpx-sse\b/.test(text)) out.push(finding(byId['M-PY-HTTPX-SSE'], path, 1, 'httpx-sse'));
    return out;
}

/** Pure: findings that need the whole project in view. files: [{ path, text, lang }] */
export function scanProject(files, projectRules) {
    const byId = Object.fromEntries(projectRules.map(r => [r.id, r]));
    const out = [];
    const ts = files.filter(f => f.lang === 'ts');
    const tsSrc = ts.filter(f => !isTestPath(f.path));
    const builds = tsSrc.filter(f => /\bnew\s+McpServer\s*\(/.test(f.text));
    const serves = tsSrc.some(f => /\b(serveStdio|createMcpHandler)\s*\(/.test(f.text));
    if (builds.length > 0 && !serves) out.push(finding(byId['TS-NO-MODERN-ENTRY'], builds[0].path, 1, 'new McpServer(...)'));
    const tsTests = ts.filter(f => isTestPath(f.path) && /\bnew\s+Client\s*\(/.test(f.text));
    if (tsTests.length > 0 && !tsTests.some(f => /2026-07-28|mode:\s*['"]auto['"]/.test(f.text))) out.push(finding(byId['TS-TESTS-LEGACY-ONLY'], tsTests[0].path, 1, 'new Client(...)'));
    const pyTests = files.filter(f => f.lang === 'py' && isTestPath(f.path) && /\bClient\s*\(/.test(f.text));
    if (pyTests.length > 0 && !pyTests.some(f => /["']legacy["']/.test(f.text))) out.push(finding(byId['PY-TESTS-MODERN-ONLY'], pyTests[0].path, 1, 'Client(...)'));
    const reaskRule = byId['TS-REASK-AFTER-DECLINE'];
    for (const f of tsSrc.filter(x => reaskRule && /\binputRequired\s*\(/.test(x.text) && /\bacceptedContent\s*\(/.test(x.text) && !/\binputResponse\s*\(/.test(x.text))) {
        // A handler that reads inputResponses only through acceptedContent cannot tell "not asked yet" from "declined".
        const reads = (f.text.match(/\binputResponses\b/g) ?? []).length;
        const viaAccepted = (f.text.match(/\bacceptedContent\s*\(\s*[\w.?]*inputResponses\b/g) ?? []).length;
        if (reads === viaAccepted) {
            const at = f.text.search(/\bacceptedContent\s*\(/);
            out.push(finding(reaskRule, f.path, lineAt(f.text, at), 'acceptedContent(...) without inputResponse(...)'));
        }
    }
    const closureRule = byId['PY-RESOLVE-CLOSURE-STRING-ANNOTATIONS'];
    const stringAnnotations = f => /^from\s+__future__\s+import\s+[^\n#]*\bannotations\b/m.test(f.text) && /^\s*(from|import)\s+mcp\b/m.test(f.text);
    for (const f of files.filter(x => closureRule && x.lang === 'py' && !isTestPath(x.path) && stringAnnotations(x))) {
        for (const m of f.text.matchAll(/\bResolve\(\s*([A-Za-z_]\w*)/g)) {
            if (new RegExp(`^[ \\t]+(?:async[ \\t]+)?def[ \\t]+${m[1]}\\b`, 'm').test(f.text)) {
                out.push(finding(closureRule, f.path, lineAt(f.text, m.index), m[0]));
                break;
            }
        }
    }
    return out;
}

/** Pure: JSON with comments and trailing commas (tsconfig.json), or null. Strings are left alone. */
export function parseJsonc(text) {
    let out = '';
    let inString = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        const n = text[i + 1];
        if (inString) {
            out += c;
            if (c === '\\') out += text[++i] ?? '';
            else if (c === '"') inString = false;
        } else if (c === '"') {
            inString = true;
            out += c;
        } else if (c === '/' && n === '/') {
            while (i < text.length && text[i] !== '\n') i++;
            out += '\n';
        } else if (c === '/' && n === '*') {
            i += 2;
            while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
            i++;
        } else out += c;
    }
    try {
        return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
    } catch {
        return null;
    }
}

/** Pure: does a tsconfig's include (or files) cover a file? Paths are relative to the scanned root. */
export function includedBy(configPath, cfg, filePath) {
    const dir = configPath.includes('/') ? configPath.slice(0, configPath.lastIndexOf('/') + 1) : '';
    if (!filePath.startsWith(dir)) return false;
    const rel = filePath.slice(dir.length);
    const patterns = Array.isArray(cfg.include) ? cfg.include : Array.isArray(cfg.files) ? cfg.files : ['**/*'];
    return patterns.some(pattern => {
        const p = String(pattern).replace(/^\.\//, '').replace(/\/$/, '');
        let re = '';
        for (let i = 0; i < p.length; i++) {
            if (p[i] === '*' && p[i + 1] === '*') {
                re += '.*';
                i += p[i + 2] === '/' ? 2 : 1;
            } else if (p[i] === '*') re += '[^/]*';
            else if (p[i] === '?') re += '[^/]';
            else re += p[i].replace(/[.+^${}()|[\]\\]/g, '\\$&');
        }
        return new RegExp(`^${re}(/.*)?$`).test(rel);
    });
}

/** Pure: config findings. TypeScript >= 6 includes no @types packages unless tsconfig lists them. */
export function scanConfig(files, projectRules) {
    const rule = projectRules.find(r => r.id === 'TS-TSCONFIG-NO-NODE-TYPES');
    if (!rule) return [];
    const deps = files.filter(f => f.kind === 'package.json').map(f => {
        try {
            const pkg = JSON.parse(f.text);
            return { ...pkg.peerDependencies, ...pkg.devDependencies, ...pkg.dependencies };
        } catch {
            return {};
        }
    });
    const usesMcp = deps.some(d => Object.keys(d).some(k => k.startsWith('@modelcontextprotocol/')));
    const tsFloor = deps.map(d => d.typescript).filter(Boolean).map(floorOf).find(Boolean);
    const nodeFiles = files.filter(f => f.lang === 'ts' && /\bprocess\.|from\s+['"]node:|\bNodeJS\./.test(f.text));
    if (!usesMcp || !tsFloor || tsFloor[0] < 6 || nodeFiles.length === 0) return [];
    const out = [];
    for (const f of files.filter(x => x.kind === 'tsconfig')) {
        const cfg = parseJsonc(f.text);
        if (!cfg || cfg.extends) continue; // unreadable or inherited: says nothing
        if (!nodeFiles.some(n => includedBy(f.path, cfg, n.path))) continue; // this config compiles no Node code
        if (cfg.compilerOptions?.types === undefined) {
            const at = f.text.indexOf('"compilerOptions"');
            const hit = finding(rule, f.path, at < 0 ? 1 : lineAt(f.text, at), '"compilerOptions" without "types"');
            // The HTTP adapters' typings pull Node's types in, so such a build works today and breaks only if that import goes.
            const carried = files.some(x => x.lang === 'ts' && includedBy(f.path, cfg, x.path) && /from\s+['"](@modelcontextprotocol\/(express|node)|express)['"]/.test(x.text));
            out.push(carried ? { ...hit, severity: 'warn', says: `${rule.says} (today an imported HTTP adapter carries them in)` } : hit);
        }
    }
    return out;
}

/** Pure: every finding for a set of files. */
export function check(files, ruleset) {
    const src = files.filter(f => f.lang);
    const facts = projectFacts(files);
    return [
        ...src.flatMap(f => scanSource(f.path, f.text, f.lang, ruleset.rules, ruleset.markers, facts)),
        ...files.filter(f => f.kind === 'package.json').flatMap(f => scanPackageJson(f.path, f.text, ruleset.manifests)),
        ...files.filter(f => f.kind === 'python-manifest').flatMap(f => scanPythonManifest(f.path, f.text, ruleset.manifests)),
        ...scanProject(src, ruleset.project),
        ...scanConfig(files, ruleset.project)
    ];
}

/** Pure: self-test results — every rule must match its bad example and miss its good one. */
export function selfTest(ruleset) {
    const failures = [];
    const facts = { 'zod-below-4.2-or-unknown': true };
    for (const rule of ruleset.rules) {
        const lang = rule.lang === 'any' ? 'ts' : rule.lang;
        const ext = lang === 'py' ? '.py' : '.ts';
        const marker = rule.anyFile || rule.badFile ? '' : `${ruleset.markers[lang]?.example ?? ''}\n`;
        const badText = rule.badFile ?? `${marker}${rule.bad}`;
        const bad = scanSource(`bad${ext}`, badText, lang, [rule], ruleset.markers, facts);
        const goodText = rule.badFile ? rule.badFile.replace(rule.bad, rule.good) : `${marker}${rule.good}`;
        const good = scanSource(`good${ext}`, goodText, lang, [rule], ruleset.markers, facts);
        if (bad.length === 0) failures.push(`${rule.id}: pattern misses its bad example`);
        if (good.length > 0) failures.push(`${rule.id}: pattern matches its good example`);
    }
    const zodSafe = projectFacts([{ kind: 'package.json', text: JSON.stringify({ dependencies: { zod: '4.6.5' } }) }]);
    const zodRule = ruleset.rules.find(r => r.id === 'TS-ZOD-ROOT');
    if (zodRule && scanSource('x.ts', `${ruleset.markers.ts?.example ?? ''}\n${zodRule.bad}`, 'ts', [zodRule], ruleset.markers, zodSafe).length > 0) {
        failures.push('TS-ZOD-ROOT: fires although the manifest pins zod >= 4.2');
    }
    const plain = scanSource('x.ts', "const r = await fetch(url);\nexport class ErrorCode {}\nErrorCode.x; foo.createMessage('hi');", 'ts', ruleset.rules, ruleset.markers, facts);
    if (plain.length > 0) failures.push(`code rules fire on a file that does not import the MCP SDK: ${plain.map(f => f.id).join(', ')}`);
    const doc = scanSource('x.py', 'from mcp import Client\ndef f():\n    """Raise so the harness sees\n    ``CallToolResult.isError``."""\n    return 1', 'py', ruleset.rules, ruleset.markers, facts);
    if (doc.length > 0) failures.push(`code rules fire inside a Python docstring: ${doc.map(f => f.id).join(', ')}`);
    const pkgBad = scanPackageJson('package.json', JSON.stringify({ dependencies: { '@modelcontextprotocol/sdk': '^1.25.0', zod: '^3.25.0' } }), ruleset.manifests);
    const pkgGood = scanPackageJson('package.json', JSON.stringify({ dependencies: { '@modelcontextprotocol/server': '^2.3.1', zod: '^4.6.5' } }), ruleset.manifests);
    if (pkgBad.length !== 2) failures.push(`package.json rules: expected 2 findings on bad manifest, got ${pkgBad.length}`);
    if (pkgGood.length !== 0) failures.push(`package.json rules: expected 0 findings on good manifest, got ${pkgGood.length}`);
    const pyCases = [
        ['dependencies = ["mcp>=1.25"]', 1],
        ['dependencies = ["mcp[cli]>=1.2,<2"]', 1],
        ['dependencies = ["mcp"]', 1],
        ['dependencies = ["mcp>=1.25"]', 1],
        ['dependencies = ["mcp[cli]>=2.3,<3"]', 0],
        ['mcp==2.3.0', 0],
        ['dependencies = [\n  "mcp[cli]>=2,<3",\n  "pydantic>=2.12",\n]', 0]
    ];
    for (const [text, expected] of pyCases) {
        const got = scanPythonManifest('pyproject.toml', text, ruleset.manifests).length;
        if (got !== expected) failures.push(`python manifest ${JSON.stringify(text)}: expected ${expected} finding(s), got ${got}`);
    }
    const closure = (future, nested) => `${future ? 'from __future__ import annotations\n' : ''}from typing import Annotated\nfrom mcp.server.mcpserver import Resolve\n${nested ? '' : 'async def ask(id: str):\n    return None\n'}def create_server(api):\n${nested ? '    async def ask(id: str):\n        return None\n' : ''}    async def void(id: str, c: Annotated[C, Resolve(ask)]) -> str:\n        return ''\n`;
    const floors = [['^7.0.2', [7, 0]], ['^4.2.0', [4, 2]], ['^3.25 || ^4', [3, 25]], ['>=2.0.0-alpha.12', [2, 0]], ['4.6.5', [4, 6]]];
    for (const [range, expected] of floors) {
        if (JSON.stringify(floorOf(range)) !== JSON.stringify(expected)) failures.push(`floorOf(${range}): expected ${expected}, got ${floorOf(range)}`);
    }
    if (scanPackageJson('package.json', JSON.stringify({ dependencies: { '@modelcontextprotocol/server': '^2.3.1', zod: '^4.2.0' } }), ruleset.manifests).length !== 0) {
        failures.push('M-PKG-ZOD fires on zod ^4.2.0');
    }
    const reask = (guard) => `import { acceptedContent, inputRequired, inputResponse } from '@modelcontextprotocol/server';\nserver.registerTool('t', {}, async ({ id }, ctx) => {\n${guard}\n    const a = acceptedContent(ctx.mcpReq.inputResponses, 'confirm', Confirm);\n    if (a?.confirm !== true) return inputRequired({ inputRequests: {} });\n    return { content: [] };\n});`;
    const reaskCases = [[reask(''), 1], [reask("    if (inputResponse(ctx.mcpReq.inputResponses, 'confirm').kind === 'missing') return inputRequired({ inputRequests: {} });"), 0], [reask('    if (!ctx.mcpReq.inputResponses?.confirm) return inputRequired({ inputRequests: {} });'), 0]];
    for (const [text, expected] of reaskCases) {
        const got = scanProject([{ path: 'src/server.ts', text, lang: 'ts' }], ruleset.project).filter(f => f.id === 'TS-REASK-AFTER-DECLINE').length;
        if (got !== expected) failures.push(`TS-REASK-AFTER-DECLINE: expected ${expected}, got ${got}`);
    }
    const projCases = [[closure(true, true), 1], [closure(false, true), 0], [closure(true, false), 0]];
    for (const [text, expected] of projCases) {
        const got = scanProject([{ path: 'server.py', text, lang: 'py' }], ruleset.project).filter(f => f.id === 'PY-RESOLVE-CLOSURE-STRING-ANNOTATIONS').length;
        if (got !== expected) failures.push(`PY-RESOLVE-CLOSURE-STRING-ANNOTATIONS on ${JSON.stringify(text.slice(0, 60))}…: expected ${expected}, got ${got}`);
    }
    const pkg = ts => JSON.stringify({ dependencies: { '@modelcontextprotocol/server': '^2.3.1' }, devDependencies: { typescript: ts } });
    const cfgCases = [
        [pkg('^7.0.2'), '{ "compilerOptions": { "strict": true } }', 1],
        [pkg('^7.0.2'), '// comment\n{ "compilerOptions": { "strict": true, }, }', 1],
        [pkg('^7.0.2'), '{ "$schema": "https://json.schemastore.org/tsconfig", "compilerOptions": { "types": ["node"] } }', 0],
        [pkg('^5.9.3'), '{ "compilerOptions": { "strict": true } }', 0],
        [pkg('^7.0.2'), '{ "extends": "@tsconfig/node22/tsconfig.json" }', 0],
        [pkg('^7.0.2'), '{ "compilerOptions": { "lib": ["DOM"] }, "include": ["ui"] }', 0],
        [pkg('^7.0.2'), '{ "compilerOptions": { "strict": true }, "include": ["src/**/*.ts"] }', 1]
    ];
    for (const [pkgText, tsconfig, expected] of cfgCases) {
        const got = scanConfig([{ kind: 'package.json', path: 'package.json', text: pkgText }, { kind: 'tsconfig', path: 'tsconfig.json', text: tsconfig }, { lang: 'ts', path: 'src/deps.ts', text: 'export const port = process.env.PORT;' }], ruleset.project).filter(x => x.severity === 'error').length;
        if (got !== expected) failures.push(`TS-TSCONFIG-NO-NODE-TYPES on ${tsconfig}: expected ${expected}, got ${got}`);
    }
    const carried = scanConfig([{ kind: 'package.json', path: 'package.json', text: pkg('^7.0.2') }, { kind: 'tsconfig', path: 'tsconfig.json', text: '{ "compilerOptions": {} }' }, { lang: 'ts', path: 'src/http.ts', text: "import { toNodeHandler } from '@modelcontextprotocol/node';\nconst p = process.env.PORT;" }], ruleset.project);
    if (carried.length !== 1 || carried[0].severity !== 'warn') failures.push('TS-TSCONFIG-NO-NODE-TYPES: should be a warning when an HTTP adapter import carries the Node types');
    cfgCases.push(['carried', '', 'warn']);
    return { checked: ruleset.rules.length + 5 + pyCases.length + floors.length + 1 + reaskCases.length + projCases.length + cfgCases.length, failures };
}

/** Pure: the rule catalogue as a Markdown table (the single source is drift_rules.json). */
export function rulesTable(ruleset) {
    const esc = s => String(s).replace(/\|/g, '\\|');
    const row = (r, scope) => `| ${r.id} | ${scope} | ${r.severity}${r.silent ? ', silent' : ''} | ${esc(r.says)} | ${esc(r.fix)} |`;
    return [
        '| Rule | Scope | Fails | v1 habit | v2 form |',
        '|---|---|---|---|---|',
        ...ruleset.rules.map(r => row(r, r.lang)),
        ...ruleset.project.map(r => row(r, 'project')),
        ...ruleset.manifests.map(r => row(r, 'manifest'))
    ].join('\n');
}

export function format(findings, fileCount) {
    const errors = findings.filter(f => f.severity === 'error').length;
    const warns = findings.length - errors;
    const head = `check_v2: ${errors} error(s), ${warns} warning(s) in ${fileCount} file(s)`;
    const body = findings
        .sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line)
        .map(f => `${f.path}:${f.line}  ${f.severity.toUpperCase()}  ${f.id}${f.silent ? '  [silent: compiles/imports, fails at runtime or for modern clients]' : ''}\n    ${f.source}\n    v1 habit: ${f.says}\n    v2: ${f.fix}`);
    const tail = errors === 0 ? 'GREEN: no v1 fingerprints at error severity.' : 'RED: fix every error; reference/drift.md explains each rule id.';
    return [head, ...body, tail].join('\n\n');
}

// ---------------------------------------------------------------- imperative shell

function walk(dir, root, acc) {
    for (const name of readdirSync(dir)) {
        if (SKIP_DIRS.has(name)) continue;
        const full = join(dir, name);
        const st = statSync(full);
        if (st.isDirectory()) walk(full, root, acc);
        else if (st.size < 2_000_000) acc.push(full);
    }
    return acc;
}

function readProject(root, languages) {
    const st = statSync(root);
    const paths = st.isDirectory() ? walk(root, root, []) : [root];
    return paths.map(full => {
        const path = relative(st.isDirectory() ? root : dirname(root), full) || full;
        const base = path.split(/[/\\]/).pop();
        const kind = base === 'package.json' ? 'package.json' : base === 'tsconfig.json' ? 'tsconfig' : base === 'pyproject.toml' || /^requirements.*\.txt$/.test(base) ? 'python-manifest' : null;
        const lang = langOf(full, languages);
        if (!lang && !kind) return null;
        return { path, text: readFileSync(full, 'utf8'), lang, kind };
    }).filter(Boolean);
}

function main(argv) {
    const ruleset = loadRules(readFileSync(join(HERE, 'drift_rules.json'), 'utf8'));
    if (argv.includes('--rules')) {
        console.log(rulesTable(ruleset));
        return 0;
    }
    if (argv.includes('--self-test')) {
        const { checked, failures } = selfTest(ruleset);
        console.log(failures.length ? `self-test RED (${failures.length}/${checked}):\n  ${failures.join('\n  ')}` : `self-test GREEN: ${checked} cases`);
        return failures.length ? 1 : 0;
    }
    const target = argv.find(a => !a.startsWith('--'));
    if (!target) {
        console.error('usage: node check_v2.mjs <project-dir|file> [--json] | --self-test');
        return 2;
    }
    const files = readProject(resolve(target), ruleset.languages);
    const findings = check(files, ruleset);
    console.log(argv.includes('--json') ? JSON.stringify({ files: files.length, findings }, null, 2) : format(findings, files.length));
    return findings.some(f => f.severity === 'error') ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
