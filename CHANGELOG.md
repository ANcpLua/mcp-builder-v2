# Changelog

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
