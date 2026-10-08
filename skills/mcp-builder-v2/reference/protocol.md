# Spec 2026-07-28 for server authors

Only what changes how you write a server. Source: `docs/specification/2026-07-28/` in modelcontextprotocol/modelcontextprotocol. The changelog there is the authority when this page and the spec disagree.

## Eras

The SDKs call the two behaviour families *eras*:

| | legacy | modern |
|---|---|---|
| Revisions | 2024-11-05 … 2025-11-25 | 2026-07-28 |
| Opening | `initialize` handshake, session | none: every request carries `_meta` (protocol version, client capabilities) |
| Discovery | `InitializeResult` | `server/discover` (required) |
| Server→client requests | pushed mid-call | returned as `input_required` (MRTR) |
| Change notifications | unsolicited | `subscriptions/listen` stream, only what the client asked for |
| Sessions | `Mcp-Session-Id`, GET stream, DELETE | removed |

**Compatibility.** A legacy client cannot talk to a modern-only server, and a modern client probes first. So a server serves **both** eras. That is the SDK default for `serveStdio`, for `createMcpHandler` (`legacy: 'stateless'`) and for Python `MCPServer`. Hosts and the Inspector still connect in the legacy era by default, which means a server that answers *only* legacy looks healthy until a modern client arrives. That is why every check in this skill runs the modern era explicitly.

## State lives in handles, not sessions

- **`tools/list`, `prompts/list` and `resources/list`** must not vary per connection. They may vary by the caller's authorization.
- **State that outlives one call** (a cart, an upload, a long job) is an explicit **handle**: an opaque id a tool returns and the model passes back as an argument. On every call, check authorization against the handle. Say in the description how long a handle lives, and when it has expired return an `isError` result that names the tool that creates a new one.
- **State across the rounds of one call** goes in `requestState`. It comes back from the client, so it is attacker-controlled input: sign it (TS `createRequestStateCodec`; Python handles it inside `Resolve`), and bind it to the principal with a TTL.

## Asking for input mid-call (MRTR)

Only `tools/call`, `prompts/get` and `resources/read` may return `resultType: "input_required"`, carrying `inputRequests` (elicitation, sampling or roots requests keyed by name) and/or `requestState`.

- The client answers the requests and retries the call with `inputResponses`.
- The handler runs again on every round, so it reads the answers that are present and asks only for the missing ones.
- Never ask for a kind the client did not declare. The SDK rejects that with -32021.
- A missing answer means you ask again; it is not an error.

SDK forms: `reference/typescript.md` and `reference/python.md`, "Asking the user mid-call".

## Results and caching

- **`resultType`** is on every result. The SDKs set it.
- **`ttlMs` and `cacheScope`** are required on `tools/list`, `prompts/list`, `resources/list`, `resources/templates/list`, `resources/read` and `server/discover`. The SDK default is `0` / `private`. Raise them only for results that are identical for every caller.
- **Tool order.** `tools/list` returns tools in a stable order. The SDKs keep registration order, so register deterministically.
- **Structured output.** A tool with `outputSchema` returns `structuredContent` plus the same JSON in a text block. The roadmap is redesigning this pairing (SEP-2200, SEP-3279), so keep both consistent and keep the text model-readable.

## Schemas

Tool schemas are full JSON Schema 2020-12:

- `inputSchema` keeps `type: "object"` at the root.
- `outputSchema` may have any root, arrays included.
- Only local `$ref` into `#/$defs/...` is allowed; never network refs.
- Large `oneOf`/`if-then` trees cost the model context, so prefer flat objects with enums.

**`x-mcp-header`.** `"x-mcp-header": "Region"` on a top-level string, integer or boolean property makes clients mirror the value as the `Mcp-Param-Region` header (for routing and WAFs). Never put it on secrets or PII, or on `number` fields; an invalid annotation makes clients drop the tool.

## Errors

| Code | Meaning | Who emits it |
|---|---|---|
| -32602 | invalid params, unknown tool, **resource not found** (was -32002) | SDK / you, for resources and prompts |
| -32601 | method not found (HTTP 404) | SDK |
| -32020 | header mismatch (HTTP 400) | SDK |
| -32021 | missing required client capability (HTTP 400) | SDK, when you ask for undeclared input |
| -32022 | unsupported protocol version (HTTP 400) | SDK |

Tool failures the model should see are `isError: true` results, not error codes. Application codes stay outside -32768…-32000; -32000…-32019 is legacy, and -32020…-32099 is reserved for the spec.

## Transport and HTTP

- **Endpoint.** Streamable HTTP is one POST endpoint (conventionally `/mcp`). Every POST carries `MCP-Protocol-Version`, `Mcp-Method` and, for `tools/call`, `resources/read` and `prompts/get`, `Mcp-Name`. The SDK cross-checks these against the body.
- **Cancellation** on HTTP is the client closing the response stream. Honour `ctx.mcpReq.signal` (TS) and cancellation (Python) by passing them to your I/O.
- **HTTP+SSE** (the 2024 transport) is not part of 2026-07-28 and is deprecated.
- **Localhost servers** validate `Host` and `Origin` (DNS rebinding). The SDK app factories do this; keep them.

## Auth (remote servers)

Unchanged in substance from 2025-11-25:

- Serve Protected Resource Metadata (RFC 9728).
- Validate the token audience (RFC 8707).
- Never pass the client's token through to upstream APIs.
- Put `scope` in `WWW-Authenticate`, and account for scope hierarchies.

The authorization server is a dedicated IdP; the v2 SDKs no longer ship one.

## Extensions

Extensions are opt-in features declared in `capabilities.extensions` and checked against each request's client capabilities; when either side lacks one, it falls back to core behaviour.

- **Stable:** MCP Apps (`io.modelcontextprotocol/ui`), Tasks (`io.modelcontextprotocol/tasks`, SEP-2663; neither SDK implements it yet), Enterprise-Managed Authorization, Skills over MCP (`io.modelcontextprotocol/skills`).
- **Newer:** Server Card (`io.modelcontextprotocol/server-card`), a static card at `<endpoint>/server-card` describing identity, endpoints and supported versions.

## Deprecated: do not build on these

- **Sampling, Roots, Logging** (SEP-2577) may be removed from the first revision released on or after 2027-07-28. Instead:
  - call your LLM provider directly;
  - take paths as tool arguments;
  - log to stderr or OpenTelemetry (`traceparent`/`tracestate`/`baggage` are reserved `_meta` keys).
- **`includeContext`** values other than `none`.
- **The HTTP+SSE transport.**
- **Dynamic Client Registration**, replaced by Client ID Metadata Documents (client and authorization-server concern).
- **The 2025-11-25 experimental tasks**: `execution.taskSupport`, `tasks/*` in core.
