# Changelog

## 0.1.5 (2026-10-09)

Packaging for the Claude plugin directory. No change to the skill's instructions or templates.

- The plugin now lives in `plugins/mcp-builder-v2/`; the repository root keeps the maintainer's CI (`ci/`, `.github/`) and a
  `marketplace.json`, so installs no longer include them. Install: `/plugin install mcp-builder-v2 --marketplace ANcpLua/mcp-builder-v2`.
- `plugin.json`: documentation, privacy policy, support and terms links for the directory listing.
- README: example prompts, the newest results first, tested surfaces, a security contact. New `SECURITY.md`.
- `verify_server.mjs` sets the one variable the Inspector needs instead of copying the whole environment into each call.
- `reference/typescript.md` points to the live docs named in `SKILL.md` instead of repeating the URL.

## 0.1.4 (2026-10-09)

For the directory submission. No change to the skill's instructions, templates or scripts.

- `SKILL.md`: the `description` is quoted. Unquoted, its "Python: building" is invalid YAML for strict parsers.
- README: new "Privacy and network use" section, listing everything the scripts run, fetch and send. `PRIVACY.md` adds
  storage and retention, the scaffold installs, and the variables that turn on the weekly check's telemetry.

## 0.1.3 (2026-10-09)

Inspector 2.9.0 → 2.10.1; all maintenance.md gates green against both protocol eras.

## 0.1.2 (2026-10-08)

Declined confirmations:

- TypeScript: the reference re-issued `inputRequired` whenever `acceptedContent` was `undefined`, which includes a decline.
  The user saw the dialog 8 to 10 times, then the call failed with "still required input after 10 rounds". The example now
  asks only while `inputResponse(...)` is `missing` and answers a decline with a normal "did not" result. New `check_v2`
  warning `TS-REASK-AFTER-DECLINE`.
- Python: the example types the parameter `ElicitationResult[Confirm]`, so decline and cancel reach the tool instead of
  ending in the SDK's generic resolver error.
- Both examples ran verbatim against declining, unticking and accepting clients of both eras. 67 self-test cases.

## 0.1.1 (2026-10-08)

Fixes from the first held-out run:

- TypeScript template: `tsconfig.json` sets `"types": ["node"]`. TypeScript 7 adds no `@types` packages by default; the
  template compiled only because its HTTP entry pulled Node's types in, so stdio-only servers copied from it failed `tsc`.
- Python template: `server.py` drops `from __future__ import annotations`. With it, a `Resolve(...)` resolver defined
  inside `create_server` made `MCPServer` raise `InvalidSignature` at registration. `reference/python.md` says so.
- `check_v2`: new project rules `TS-TSCONFIG-NO-NODE-TYPES` and `PY-RESOLVE-CLOSURE-STRING-ANNOTATIONS`. The version-floor
  parser read `^4.2.0` as 0.0, so zod ranges ending in `.0` raised false `M-PKG-ZOD` / `TS-ZOD-ROOT` findings; fixed.
  64 self-test cases.
- `SKILL.md` gate 2 runs `npm run typecheck` before `npm test` (tsx does not type-check).

Re-running the two affected cases on 0.1.1 (Haiku 5.5, 3 runs per arm): 18/18 and 17/18 with the skill, was 6/18 and 0/18.

## 0.1.0 (2026-10-07)

First version.
