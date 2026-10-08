# Drift: where v1 recall breaks v2 code

**Drift** is what happens when code written from memory slides toward the MCP SDK v1. Most published MCP code is v1 (`@modelcontextprotocol/sdk`, `FastMCP`, sessions), so an agent's recall is v1-shaped unless something stops it. This page is reached when `check_v2` reports a rule id, when you migrate v1 code, or when you review someone else's server.

The rule-by-rule catalogue lives in one place, `scripts/drift_rules.json`. Print it with `node scripts/check_v2.mjs --rules`.

## How this list was built

On 2026-10-07 the skill author wrote a TypeScript server, a Python server and a Python client from memory, then ran them against the v2 SDKs:

| From-memory code | Result under v2 |
|---|---|
| TS: `import { StreamableHTTPServerTransport } from '@modelcontextprotocol/server/streamableHttp.js'` + session map + `server.connect(transport)` | `tsc` reported only the deep import. Fix that and it compiles, then serves **only legacy clients**. |
| TS: `inputSchema: { city: z.string() }`, `import { z } from 'zod'` | **Compiles** (deprecated overload), with no warning. |
| TS: `server.connect(new StdioServerTransport())` | **Compiles, passes the default Inspector, passes a default `Client` test**, and modern clients get `Version negotiation failed: the server did not offer pinned protocol version 2026-07-28`. |
| Py: `from mcp.server.fastmcp import Context` | `ModuleNotFoundError`, with a pointer to the migration guide. (loud) |
| Py: `MCPServer("x", stateless_http=True, json_response=True)` | `TypeError: unexpected keyword argument 'stateless_http'`. (loud) |
| Py: `await ctx.info(...)` | Runs; emits only an `MCPDeprecationWarning`, and the log is dropped for modern requests. (silent) |
| Py client: `streamablehttp_client(url) as (read, write, _)` + `ClientSession` + `initialize()` | `ImportError`. (loud) |

Then four fresh agents built the same library server (4 tools, stdio + HTTP), each checked independently with `check_v2` and `verify_server`:

| Agent | Packages chosen | check_v2 | modern era | Its own verdict |
|---|---|---|---|---|
| TS, from memory, no docs | `@modelcontextprotocol/sdk@1.32.1` (v1) | 16 errors | **RED** (version negotiation failed) | "20/20 checks passed": its smoke test and the Inspector ran in the legacy era |
| TS, original v1 mcp-builder skill | v2 (the fetched README is v2 now) | 0 errors, 1 warning (tests legacy-only) | GREEN | reached v2 by reconciling the guide against fetched docs: 80 tool calls, ~15 min |
| TS, this skill | v2 | 0 | GREEN | gates GREEN on the first run: 31 tool calls, ~9 min |
| Python, this skill | `mcp` 2.3.0 | 0 | GREEN | gates GREEN on the first run: 29 tool calls, ~6 min |

The pattern: **Python v2 mostly fails loudly; TypeScript v2 mostly fails silently**, because deprecated overloads and legacy-era wiring keep v1 shapes compiling. Rules marked `silent` in `check_v2` output are the ones a compiler or a happy-path test will not catch.

## Drift point 1: the wiring (TypeScript)

Recall writes a transport object and connects a server instance to it. Under v2 that is the legacy-era entry point: it type-checks, runs and answers the Inspector, and answers no modern client.

The v2 wiring is a **factory handed to an entry point**:

- `serveStdio(() => createServer(deps))` for local servers;
- `createMcpHandler(() => createServer(deps))` for remote ones.

The factory lets the SDK build a fresh instance per request (HTTP) or per connection (stdio) and pick the era from the client's first message. The rules are `TS-STDIO-CONNECT`, `TS-HTTP-TRANSPORT`, `TS-SESSIONS` and `TS-NO-MODERN-ENTRY`.

## Drift point 2: false proofs

Each of these *looks* like verification and proves only the legacy era:

| Looks like proof | Why it is not | What proves it |
|---|---|---|
| "Works in the Inspector" | Inspector 2.x connects with `protocolEra: "legacy"` unless told otherwise | `scripts/verify_server.mjs` (pins `modern` and `legacy`) |
| "The TS tests pass" | TS `Client` defaults to the legacy handshake | a test client with `versionNegotiation: { mode: { pin: '2026-07-28' } }` |
| "The Python tests pass" | Python `Client` defaults to `auto`, so it is modern; that is the opposite gap, no legacy coverage | parametrize `mode` over `"2026-07-28"` and `"legacy"` |
| "Conformance passed" | `npx @modelcontextprotocol/conformance` resolves the `latest` tag (0.1.16), which has no 2026-07-28 scenarios | the alpha pinned in `pins.json` |
| "The official quickstart does it this way" | The modelcontextprotocol.io 2026-07-28 TypeScript quickstart still wires `server.connect(new StdioServerTransport())`, which serves only the legacy era | `templates/typescript/src/stdio.ts` |
| "It compiles" | v2 keeps deprecated overloads for raw shapes and legacy transports | `check_v2` |

## Drift point 3: schemas (TypeScript)

The v2 form, every time:

- `import * as z from 'zod/v4'`, with `zod` ^4.2 in `package.json`;
- every schema written as `z.object({...})`.

A Zod 3 range installs and type-checks, then fails at the first `tools/list` with an error pointing at `fromJsonSchema()`. Zod 4.0–4.1 silently drops `.describe()` texts. The rules are `TS-RAW-SHAPE`, `TS-ZOD-ROOT` and `M-PKG-ZOD`.

## Drift point 4: talking back to the client

Recall reaches for a mid-call push: elicit, sample, log. In 2026-07-28 the server never sends requests. It *returns* `input_required`, and the client retries.

- **TS:** `inputRequired(...)` together with `acceptedContent(...)`.
- **Python:** `Annotated[T, Resolve(fn)]` with `Elicit(...)`.

Logging goes to stderr. The rules are `TS-PUSH-REQUEST`, `TS-URL-ELICIT-ERROR`, `PY-PUSH-REQUEST`, `PY-CTX-LOG` and `ANY-INCLUDE-CONTEXT`.

## Drift point 5: where settings live (Python)

| Setting | Where it goes |
|---|---|
| Identity (`name`, positional; `version`, `instructions`, `title` as keywords) | the constructor |
| Behaviour (`lifespan=`, `cache_hints=`) | the constructor |
| Transport (`host`, `port`, `stateless_http`, `transport_security`) | `run(...)` or `streamable_http_app(...)` |

The second positional argument is now `title`, not `instructions`. The rules are `PY-SERVER-TRANSPORT-KWARGS`, `PY-SETTINGS-TRANSPORT`, `PY-SECOND-POSITIONAL` and `PY-STATELESS`.

## Python: the renames most projects hit

| v1 | v2 |
|---|---|
| `from mcp.server.fastmcp import FastMCP, Context` | `from mcp.server import MCPServer`; `from mcp.server.mcpserver import Context` |
| `FastMCPError` | `MCPServerError` |
| `McpError(ErrorData(...))`, `e.error.message` | `MCPError(code, message, data)`, `e.message` (`from mcp import MCPError`) |
| `mcp.get_context()`, `ctx.fastmcp` | a `ctx: Context` parameter; `ctx.mcp_server` |
| `Context[ServerSession, L, R]` | `Context[L, R]` |
| `result.isError`, `.structuredContent`, `.inputSchema`, `.nextCursor`, `.mimeType` | snake_case: `.is_error`, `.structured_content`, `.input_schema`, … |
| `streamablehttp_client(url)` → 3-tuple | `Client(url)`; or `streamable_http_client(url, http_client=httpx2.AsyncClient(...))` → 2-tuple |
| `ClientSession(read, write)` + `initialize()` | `async with Client(target) as client:` |
| `create_connected_server_and_client_session(server)` | `Client(server)` |
| `httpx.AsyncClient` handed to the SDK | `httpx2.AsyncClient` |
| `mcp>=1.x` with no ceiling | `mcp[cli]>=2.3,<3` |
| lifespan entered per session | entered once per process |

Complete list: `https://py.sdk.modelcontextprotocol.io/v2/migration/`.

## Migrating existing v1 code

**TypeScript:**

1. `npx @modelcontextprotocol/codemod@latest v1-to-v2 .` at the package root. It rewrites imports, `extra` → `ctx`, `McpError` → `ProtocolError`, `.tool()` → `registerTool` and `package.json`.
2. `grep -rn '@mcp-codemod-error' .` and resolve every marker.
3. Run `node <skill>/scripts/check_v2.mjs .`. The codemod leaves the legacy-era wiring in place (it renames `StreamableHTTPServerTransport` to `NodeStreamableHTTPServerTransport`) and writes `import { z } from 'zod'`. Fix both in place, keeping the project's files (drift points 1 and 3):
   - wrap the existing server setup in `function createServer() { …; return server; }`;
   - make the existing entry file call `serveStdio(createServer)` (stdio) or `createMcpHandler(createServer)` (HTTP);
   - switch the Zod import to `import * as z from 'zod/v4'`.

   On a v1 sample (2026-10-07), the codemod output still had four errors: `TS-STDIO-CONNECT`, `TS-NO-MODERN-ENTRY`, `TS-ZOD-ROOT` and `M-PKG-ZOD`. All four are silent.
4. Move per-session state into handles or `requestState` (`reference/protocol.md`).
5. Add the both-era test (adapt `templates/typescript/test/server.test.ts` to import the project's own `createServer`), then run `scripts/verify_server.mjs`.

**Python:** there is no codemod.

1. Set the dependency to `mcp[cli]>=2.3,<3`.
2. Run `check_v2` and fix every finding top to bottom. Each one names its v2 form.
3. Run pytest with `filterwarnings = ["error"]` to surface the silent deprecations.
4. Run `scripts/verify_server.mjs`.

## Adding a rule

Two project rules came from the first held-out run (2026-10-08), where they explained every failing reply that had the skill: `TS-TSCONFIG-NO-NODE-TYPES` (TypeScript >= 6 adds no `@types` packages, so a stdio-only server without `"types": ["node"]` fails `tsc`) and `PY-RESOLVE-CLOSURE-STRING-ANNOTATIONS` (a `Resolve(...)` resolver defined inside `create_server` under `from __future__ import annotations` raises `InvalidSignature` at registration).

When you catch a new drift (yours or another agent's), add an object to `scripts/drift_rules.json` with `id`, `lang`, `severity`, `silent`, `pattern`, `says`, `fix`, `bad` and `good`. Then run `node scripts/check_v2.mjs --self-test`; it must stay GREEN. No code change is needed.
