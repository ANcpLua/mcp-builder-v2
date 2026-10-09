---
name: mcp-builder-v2
description: "MCP server work on SDK v2 and spec 2026-07-28, in TypeScript or Python: building a new server, migrating one off SDK v1 (@modelcontextprotocol/sdk, FastMCP), checking a server for v1 drift, or writing its evaluations. Use instead of mcp-builder."
license: Complete terms in LICENSE.txt
---

# MCP server builder (SDK v2, spec 2026-07-28)

## Why this skill runs on templates and gates

Most MCP code ever published is SDK v1, so code written from memory **drifts** to v1. In TypeScript, drifted code usually still compiles against the v2 packages, passes the default Inspector, and passes a default-client test. Then it fails every client that speaks the modern **era** (2026-07-28). Three habits prevent that:

1. **Copy, don't recall.** Every SDK call comes from `templates/` or a `reference/` file. Recall is for your service's domain logic, not for SDK wiring.
2. **Prove both eras.** Tests and checks pin the modern era explicitly and also run the legacy one. A check that ran only in the default era proves nothing about modern clients.
3. **Gates decide done.** A step is done when its gate prints GREEN. All tools live in `scripts/`; all versions live in `pins.json`.

`<skill>` below means this skill's directory.

## Decisions (fixed; take them as given)

| Question | Answer |
|---|---|
| Language | TypeScript, unless the user's project or request is Python |
| TS packages | `@modelcontextprotocol/server` (+ `/node`, `/express` for HTTP); `zod` ≥ 4.2, imported as `import * as z from 'zod/v4'`. Exact ranges: `pins.json` |
| Python package | `mcp[cli]>=2.3,<3`; `from mcp.server import MCPServer` |
| Local transport | stdio. TS: `serveStdio(() => createServer(deps))`. Py: `mcp.run()` |
| Remote transport | Streamable HTTP at `/mcp`. TS: `createMcpHandler(() => createServer(deps))` on `createMcpExpressApp()`. Py: `mcp.run(transport="streamable-http", stateless_http=True)` |
| Legacy (2025) clients | served, through the SDK defaults; leave the `legacy` option unset |
| State across calls | explicit handles returned by tools; never sessions |
| Input from the user mid-call | returned `input_required`. TS: `inputRequired(...)`, asked only while `inputResponse(...)` is `missing`. Py: `Resolve` + `Elicit`, parameter typed `ElicitationResult[...]`. A decline or cancel ends the call with a normal "did not" reply |
| Logging | stderr (`console.error` / `logging`); never stdout, never protocol logging |
| Tool output | `outputSchema` + `structuredContent` + the same JSON as one text block |
| Recoverable tool failure | TS: `isError: true` result. Py: `raise ToolError(...)`. The message says what failed and what to try next. |
| Resource/prompt failure | TS: `ProtocolError` / `ResourceNotFoundError`. Py: `MCPError` / `ResourceNotFoundError` |
| Server-to-client sampling, roots, HTTP+SSE, tasks | out of scope: deprecated or extension-only (`reference/protocol.md`) |

## Architecture: functional core, imperative shell

| Layer | TypeScript | Python | Rule |
|---|---|---|---|
| Functional core | `src/domain.ts` | `<pkg>/domain.py` | types, pure helpers, and the *interface* of the data source; no I/O, no MCP imports |
| Declaration | `src/server.ts` | `<pkg>/server.py` | `createServer(deps)` / `create_server(api)` registers tools; no transport, no env, no ports |
| Imperative shell: deps | `src/deps.ts` (`loadDeps`) | `<pkg>/__main__.py` (`load_api`) | builds the real adapter (HTTP client, DB, file read) that implements the interface; the only env reads |
| Imperative shell: serving | `src/stdio.ts`, `src/http.ts` | `<pkg>/__main__.py` (`main`) | SDK serving lines, fixed: never edit them. Configure with `HOST`/`PORT`/`ALLOWED_HOSTS` |
| Contract | `test/server.test.ts` | `tests/test_server.py` | the real server, a fake data source defined in the test, both eras |

Ambiguity gets pushed to the edges: the core cannot fail on protocol details, the serving lines are copied and never edited, and the only shell code you write is dependency construction.

## Steps

### 1. Scaffold

- Copy `<skill>/templates/typescript/` or `<skill>/templates/python/` to the project directory.
- Rename identity only. Keep the example `catalog_*` tools; step 3 replaces them.
  - TS: `name` in `package.json`, and the server name string in `src/server.ts`, `src/stdio.ts` and `src/http.ts`.
  - Py: `name` and `packages` in `pyproject.toml`, the package directory, the server name string in `server.py`, and the two test imports.
- Install:
  - TS: `npm install`
  - Py: `python -m venv .venv && .venv/bin/pip install -e ".[dev]"`
- Read `<skill>/reference/typescript.md` or `<skill>/reference/python.md` once, now.

**Done when:** the template's tests pass, 8/8 (4 tests × 2 eras), and `node <skill>/scripts/check_v2.mjs .` is GREEN.

### 2. Plan the tools

- Read the data source: API documentation, database schema, or the data file.
- Replace the table in the project README. One row per tool: name (`{service}_{verb}_{noun}`), one-line purpose, inputs with bounds, output fields, the four annotations, and the upstream (endpoint, query or collection).
- **Which tools:** if the user named the tools, the table is exactly those. Otherwise there is one row per common read operation.
- Rules for names, pagination, results and errors: `<skill>/reference/design.md`.

**Done when:** every requested (or common read) operation has a row, every unbounded list has `limit`/`offset` (or a cursor), and every row has all four annotations decided.

### 3. Implement

- **Data source.** Declare its interface in the domain layer. Build the real implementation (the adapter, which does the I/O) in the deps shell: `loadDeps` or `load_api`.
- **For each row of the table:**
  - **Domain.** Pure helpers go in the domain layer.
  - **Registration.** Register the tool in the server layer by copying the shape of the template's `catalog_get_product` (single item) or `catalog_search_products` (list). The shape: input schema with described and bounded fields, output schema, the four annotations from your table, structured result, and a recoverable error that names the next step.
  - **Tests.** Add one success test, plus one recoverable-failure test when the tool has a failure path. Use the test's own fake data, and leave the both-era parametrization in place.
- **Clean up.** Delete the example `catalog_*` tools, their tests and the template's sample data.

Resources and prompts follow the matching reference section. A tool that needs user confirmation, or state across rounds, follows "Asking the user mid-call" there, plus `<skill>/reference/protocol.md`.

**Done when:** every table row is registered and tested, no `catalog` example remains, and the test suite is GREEN in both eras.

### 4. Gate

Run gates 1–3 from `<skill>/reference/verify.md`, in order. Every RED line names its cause; for `check_v2` findings, the rule id is explained in `<skill>/reference/drift.md`.

1. `node <skill>/scripts/check_v2.mjs .`
2. the type check and contract tests: `npm run typecheck && npm test`, or `.venv/bin/pytest -q` (`npm test` runs through tsx, which does not type-check)
3. `verify_server` against the real stdio command:
   - `node <skill>/scripts/verify_server.mjs --cwd . -- <stdio command>`
   - If the server is remote, also run it against HTTP, which starts and stops the server itself:
     `node <skill>/scripts/verify_server.mjs --url http://127.0.0.1:<port>/mcp --cwd . --start -- <http command>`

**Done when:** gates 1–3 print GREEN and their output is pasted into your summary.

### 5. Evaluate

This is gate 4.

- Write ten read-only, multi-hop questions with verified answers (`<skill>/reference/evaluation.md`).
- Run `<skill>/scripts/evaluation.py` against the server.
- Improve the tool names, descriptions and results Claude's feedback points at, then re-run.

**Done when:** the report exists, and every tool problem it raises is either fixed or written down as known with a reason.

## Other branches

- **Migrating v1 code.** Keep the project's layout, file names, scripts and tool names. Change only what the checker flags, and wrap the existing server setup in place in a factory (`function createServer() { …; return server; }`) that the existing entry file hands to `serveStdio` / `createMcpHandler`. The template layout is for new servers, or for a restructure the user asked for.
  - TS: run the official codemod, then `check_v2` (it catches what the codemod leaves).
  - Py: `check_v2` finding by finding.
  - Either way, add the both-era contract test and finish with gates 2–3. Procedure: `<skill>/reference/drift.md`, "Migrating existing v1 code".
- **Reviewing or checking a server.** Run gate 1 on the code and gate 3 on the running server, and report each finding with its rule id and v2 form.
- **Questions about the protocol** (eras, handles, MRTR, caching, error codes, auth, extensions, deprecations): `<skill>/reference/protocol.md`.
- **Something the references do not cover.** Read the live v2 docs (`https://ts.sdk.modelcontextprotocol.io/v2/llms.txt`, `https://py.sdk.modelcontextprotocol.io/v2/`). A page showing `@modelcontextprotocol/sdk` imports or `FastMCP` is v1 documentation; switch to the v2 page. Run `check_v2` on whatever you write from it.
- **Updating this skill** (new SDK or spec release, stale pins): `<skill>/reference/maintenance.md`, with `node <skill>/scripts/check_pins.mjs --online`.
