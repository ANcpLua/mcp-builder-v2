# Tool design

A server's quality is how well a model with no other context can use it to finish real tasks. Design for that reader.

## Choosing tools

- **Coverage first.** List the service API's endpoints and wrap the common ones as tools, one operation each. Add a workflow tool (several calls in one) only when a frequent task would otherwise take many round trips, or would leak intermediate data into context.
- **Read before write.** Ship the read and search tools first; they are what evaluations exercise, and they are what makes write tools usable, because the model needs real ids.
- **Handles for state.** A multi-step task (draft → review → send) gets a tool that returns an opaque id, plus tools that take it. There is no per-connection memory (`reference/protocol.md`).

## Naming

- **Server:** `{service}-mcp-server`, for example `github-mcp-server`. Python package: `{service}_mcp`.
- **Tools:** `{service}_{verb}_{noun}` in snake_case, for example `github_create_issue` or `slack_list_channels`.
  - The prefix keeps names unique when a host loads many servers.
  - The verb comes first: `get`, `list`, `search`, `create`, `update`, `delete`.
  - Allowed characters are `[A-Za-z0-9_.-]`, 1–128 of them.
- **`title`** is the human display name, for example "Create issue".

## Descriptions and schemas

- **First sentence** says what the tool does and returns. The next sentences say when to use it instead of its neighbours, and where its ids come from ("Ids come from `github_search_issues`").
- **Every argument** gets a description with an example value, plus its bounds: `min`/`max`, `enum`, string lengths. These are the model's only documentation.
- **Arguments the model must not invent** (the caller's identity, prices, permissions) are not arguments at all. They come from auth context or are resolved server-side (`Resolve` in Python).
- **Flat inputs.** Prefer flat objects with enums to deep `oneOf` trees.
- **Optional filters.**
  - TS: `.optional()`. Python: `Annotated[str | None, Field(...)] = None`.
  - Cross-field rules ("at least one filter") do not survive conversion to JSON Schema. Check them in the handler, and return a recoverable error that says which arguments to supply.
- **Ids.** `min(1)` plus a sane max length (e.g. 64), with an example in the description.
- **Values that come from the data**, such as genres: hard-code them as an enum when the set is fixed. Otherwise validate in the handler, and list the valid values in the error.

## Results

- **Structured output.** Declare `outputSchema` and return `structuredContent` plus the same JSON as text. Make the JSON compact and model-readable:
  - select the fields that matter;
  - give names alongside ids;
  - use ISO-8601 timestamps;
  - include no raw HTML or base64 unless asked.
- **Pagination.** Any unbounded list takes `limit` (default 20, max 100) and `offset` or `cursor`, and returns `items`, `total`, `count`, `offset`, `has_more` and `next_offset` / `next_cursor`. The templates' pure helpers do the arithmetic: `paginate` in TS, `window` in Python.
- **Embedded lists.** A child list embedded in a get result (an author's books) needs no pagination while it is small, about 20 items or fewer. Return it with a count. When it can grow without bound, give it its own list tool.
- **Empty results.** An empty search is a successful empty page, not an error.
- **Size.** Large results cost the model its context. Cap text fields, summarize long bodies, and offer a `*_get_*` tool for the full record.

## Annotations

Set all four on every tool. Clients use them to decide what to auto-approve.

| Hint | Meaning | Typical |
|---|---|---|
| `readOnlyHint` | does not modify anything | `true` for get/list/search |
| `destructiveHint` | may delete or overwrite | `true` for delete/void/overwrite |
| `idempotentHint` | repeating the call has no extra effect | `true` for get, put-style updates |
| `openWorldHint` | touches systems outside the server | `true` for any external API; `false` for data the server owns (a local file or database) |

Hints are not security. Enforce permissions in the tool.

## Errors the model can act on

Each recoverable failure says three things: what failed, why, and what to do next.

> No invoice "inv_9". Ids look like "inv_123"; use acme_search_invoices to find one.

- Map upstream 404/400/429 to those three parts. For 429, say when to retry.
- Never surface stack traces, tokens or internal hostnames.

## Security

- **Secrets** come from the environment, are read once at startup, and are never echoed.
- **Inputs** are validated by schema. In addition: confine paths to an allowed root, allow-list URLs and hosts, and never interpolate inputs into shell commands or SQL.
- **Remote servers** verify bearer tokens with the audience set to this server, and keep the Host/Origin guard on. They never forward the client's token upstream; use the server's own credentials or token exchange.
- **Localhost HTTP servers** bind `127.0.0.1`.
