#!/usr/bin/env node
// check_pins — maintenance gate for this skill (not for the server being built).
//
//   node check_pins.mjs            offline: templates and requirements agree with ../pins.json; pins not stale (> 90 days)
//   node check_pins.mjs --online   also: compare pins with the npm and PyPI registries
//
// Exit 1 when a template disagrees with pins.json. Registry news is advisory: a newer release means
// "re-verify and bump", never "bump blindly" (see reference/maintenance.md).

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(ROOT, p), 'utf8');

// ---------------------------------------------------------------- functional core

export function templateDrift(pins, pkg, pyproject, evalReq) {
    const issues = [];
    for (const section of ['dependencies', 'devDependencies']) {
        for (const [name, range] of Object.entries(pins.typescript[section])) {
            const got = pkg[section]?.[name];
            if (got !== range) issues.push(`templates/typescript/package.json ${section}.${name}: ${got ?? 'missing'} != pins ${range}`);
        }
    }
    if (!pyproject.includes(`"${pins.python.requirement}"`)) issues.push(`templates/python/pyproject.toml: dependency is not "${pins.python.requirement}"`);
    for (const req of [pins.eval.anthropic, pins.eval.mcp]) if (!evalReq.split('\n').includes(req)) issues.push(`scripts/requirements.txt: missing line "${req}"`);
    return issues;
}

export function daysBetween(fromIso, to = new Date()) {
    return Math.floor((to.getTime() - new Date(`${fromIso}T00:00:00Z`).getTime()) / 86_400_000);
}

export const baseVersion = range => (String(range).match(/\d+\.\d+\.\d+(?:-[\w.]+)?/) ?? [null])[0];

export function newer(a, b) {
    const parse = v => v.split(/[.-]/).map(x => (/^\d+$/.test(x) ? Number(x) : x));
    const [x, y] = [parse(a), parse(b)];
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return y[i] > x[i];
    return false;
}

// ---------------------------------------------------------------- imperative shell

function npmLatest(pkg, tag = 'latest') {
    try {
        return JSON.parse(execFileSync('npm', ['view', pkg, 'dist-tags', '--json'], { encoding: 'utf8', timeout: 60_000 }))[tag] ?? null;
    } catch {
        return null;
    }
}

async function pypiLatest(name) {
    try {
        const res = await fetch(`https://pypi.org/pypi/${name}/json`);
        return res.ok ? (await res.json()).info.version : null;
    } catch {
        return null;
    }
}

async function main(argv) {
    const pins = JSON.parse(read('pins.json'));
    const issues = templateDrift(pins, JSON.parse(read('templates/typescript/package.json')), read('templates/python/pyproject.toml'), read('scripts/requirements.txt'));
    const age = daysBetween(pins.verified_on);
    console.log(issues.length ? `RED  templates disagree with pins.json:\n  ${issues.join('\n  ')}` : 'GREEN templates agree with pins.json');
    console.log(age > 90 ? `WARN pins verified ${age} days ago (${pins.verified_on}); re-run reference/maintenance.md` : `ok   pins verified ${age} days ago`);
    if (argv.includes('--online')) {
        const ts = { ...pins.typescript.dependencies, ...pins.typescript.devDependencies };
        for (const [name, range] of Object.entries(ts)) {
            const latest = npmLatest(name);
            const pinned = baseVersion(range);
            console.log(`${latest && pinned && newer(pinned, latest) ? 'NEW ' : 'ok  '} npm  ${name.padEnd(32)} pinned ${range.padEnd(10)} latest ${latest ?? '?'}`);
        }
        for (const spec of [pins.tools.inspector, pins.tools.conformance]) {
            const [name, pinned] = [spec.slice(0, spec.lastIndexOf('@')), spec.slice(spec.lastIndexOf('@') + 1)];
            const tag = pinned.includes('-') ? 'alpha' : 'latest';
            const latest = npmLatest(name, tag);
            console.log(`${latest && newer(pinned, latest) ? 'NEW ' : 'ok  '} npm  ${name.padEnd(32)} pinned ${pinned.padEnd(10)} ${tag} ${latest ?? '?'}`);
        }
        for (const [name, req] of [['mcp', pins.python.requirement], ['anthropic', pins.eval.anthropic]]) {
            const latest = await pypiLatest(name);
            const floor = baseVersion(req.replace(/>=(\d+\.\d+)(?!\.)/, '>=$1.0'));
            console.log(`${latest && floor && newer(floor, latest) ? 'NEW ' : 'ok  '} pypi ${name.padEnd(32)} pinned ${req.padEnd(18)} latest ${latest ?? '?'}`);
            const major = Number(String(latest).split('.')[0]);
            if (name === 'mcp' && major > pins.python.major) console.log(`MAJOR mcp ${latest} is past the pinned major ${pins.python.major}: a new drift era starts; see reference/maintenance.md`);
        }
        const sdkLatest = npmLatest('@modelcontextprotocol/server');
        if (sdkLatest && Number(sdkLatest.split('.')[0]) > 2) console.log(`MAJOR @modelcontextprotocol/server ${sdkLatest} is past major 2: see reference/maintenance.md`);
    }
    return issues.length ? 1 : 0;
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) process.exit(await main(process.argv.slice(2)));
