# Maintaining this skill (2026–2027)

This skill is a snapshot pinned in `pins.json` (`verified_on: 2026-10-07`). Facts age; the structure is built so that refreshing it is mostly a data edit.

| Layer | Holds | Changes when |
|---|---|---|
| `pins.json` | versions, dates, tool pins | any release |
| `scripts/drift_rules.json` | v1 fingerprints, as data with self-tests | a new drift is observed |
| `scripts/conformance_scope.json` | which conformance checks apply to ordinary servers | the conformance suite changes |
| `templates/` | the runnable reference implementation | an SDK API changes |
| `reference/*.md` | explanation; every snippet mirrors the templates | the spec or an SDK changes |
| `SKILL.md` | decisions and steps | a decision changes |

## Refresh procedure (run every ~90 days, or when check_pins says NEW or MAJOR)

1. `node scripts/check_pins.mjs --online` lists newer releases. A newer release means re-verify, never bump blindly.
2. Copy both templates to a scratch directory. Install with the new versions, then run the tests (`npm test`, `pytest`), `check_v2` and `verify_server` against stdio and HTTP. Every gate must be GREEN.
3. Bump `pins.json` and the template manifests together. `node scripts/check_pins.mjs` must be GREEN, because it fails when they disagree.
4. Run `node scripts/check_v2.mjs --self-test` and `pytest -q scripts/test_evaluation.py`.
5. If this skill ships as a plugin with `evals/`, run `claude plugin eval .` from the plugin root, with the registry grants listed in the plugin README.
   - Compare WITH, W/OUT and Δ to the last recorded run.
   - A falling Δ means the model's own recall has caught up, and some rules or templates can go.
   - A failing WITH means the skill broke.
6. **Check the checker against code you didn't write.** Precision matters as much as recall: a checker that cries wolf on good v2 code gets ignored.
   - **Precision corpus:** an independently written v2 project (2026-10-08: `ANcpLua/qyl.mcp`, 180 files) must give 0 errors. The official SDK `examples/` must give errors only in files that demo legacy-era features on purpose (legacy-routing, sse-polling, push elicitation, sampling).
   - **Recall corpus:** the code blocks of the original v1 `mcp-builder` skill and fresh from-memory probes must still give errors in every v1 file.
   - **History.** On 2026-10-08 the first precision run found 25 false positives on `qyl.mcp`: zod-4 root imports, JSON-Schema literals, an HTTP-only `console.log`, and deprecated logging rated as an error. The fixes introduced SDK-import markers, the `when` facts and docstring skipping.
7. Re-run the **bias probe**:
   - Ask a fresh agent, *without* this skill, to write a small TS and Python server from memory.
   - Run `check_v2` on its output.
   - Every miss is a new rule in `drift_rules.json`; every rule that never fires again is a candidate for removal.
8. Set `verified_on`.

## Watch list

Dates are proposals unless marked.

- **Next spec revision.** SEP-3398 (draft) proposes six-monthly releases on the last Tuesday of March and September, putting the next revision at **2027-03-30** and the one after in September 2027. When a new revision ships:
  - set `spec.current`;
  - read its changelog;
  - update `reference/protocol.md`;
  - re-run conformance with the new `--spec-version`;
  - check whether the SDKs add a new era. If they do, drift rules for the 2026-era forms may be needed, the same way v1 forms are flagged today.
- **Tool result shape.** The roadmap's "improved primitives" area is redesigning `content` vs `structuredContent` (SEP-2200, SEP-3279). When that lands, the "structured output" rows in `SKILL.md`, `typescript.md`, `python.md` and the templates change together.
- **HTTP-native transport unification.** The roadmap proposes HTTP over stdio as a single binding, plus ETag caching. If adopted, the stdio entry points may change; templates first.
- **Tasks into core.** The `io.modelcontextprotocol/tasks` extension (SEP-2663) is slated to move into core, and neither SDK implements it yet. When an SDK ships it, add a "long-running work" section and decide handles vs tasks.
- **Agent identity.** DPoP (SEP-1932) and Workload Identity Federation (SEP-1933) affect remote-server auth. Update the auth paragraphs when either is Final and implemented.
- **Discovery at scale.** Primitive Groups (SEP-2084, in review), `tools/manifest`, list filtering. This matters for servers with many tools.
- **Sunsets** (`pins.json` → `sunsets`):
  - Sampling, Roots and Logging are removable from the first revision on or after 2027-07-28.
  - The TS v1 line is supported until at least 2027-01-27.
  - `@modelcontextprotocol/server-legacy` goes in TS v3.
  - Python deprecated helpers go in mcp 3.0.
- **A new SDK major (3.x).** `check_pins --online` prints MAJOR. That starts a new drift era: v2 forms become the "old" fingerprints. Repeat the bias probe against v3, write rules for the v2→v3 drift, and bump `python.major` and the TS ranges.
- **Registry.** The MCP Registry (`server.json`, schema `2025-12-11`) is still in preview. Add a publishing step only when its API is GA.
- **Conformance.** Track the `alpha` tag until a stable release carries 2026-07-28 scenarios, then move the pin to `latest`. If fixture-dependent checks change ids, update `conformance_scope.json`.
