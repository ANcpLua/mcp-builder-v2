# Python: the v2 way (`mcp` 2.x, `MCPServer`)

Every snippet here ran against the versions in `pins.json`. The runnable whole is `templates/python/`; start there and change it, rather than writing SDK calls from memory. Sections marked **drift point** are where recall produces v1 code. In Python most of that fails loudly at import or call time, and the silent cases are listed in `reference/drift.md`.

Live docs, for anything not covered: `https://py.sdk.modelcontextprotocol.io/v2/` (`/v2/llms.txt` indexes every page as `.md`). A page that shows `FastMCP` is v1 documentation, so close it and use the v2 site.

## Project

```
pyproject.toml            dependencies = ["mcp[cli]>=2.3,<3"]; pytest config with filterwarnings = ["error"]
acme_mcp/domain.py        functional core: dataclasses, pure helpers, the AcmeApi Protocol seam. No MCP imports.
acme_mcp/server.py        create_server(api) -> MCPServer: registers everything. No transport, no env.
acme_mcp/__main__.py      imperative shell: logging to stderr, load_api() builds the real adapter from env, main() serves (fixed lines)
tests/test_server.py      contract test through Client(server) with a FAKE data source, both eras
```

Setup: `python -m venv .venv && .venv/bin/pip install -e ".[dev]"`, then `.venv/bin/pytest -q`.

## Server and tools

```python
from typing import Annotated
from pydantic import BaseModel, Field
from mcp.server import MCPServer                              # drift point: MCPServer, from mcp.server
from mcp.server.mcpserver import Context                      # drift point: mcpserver package
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations

class Invoice(BaseModel):
    id: str
    total_cents: int
    status: str

def create_server(api: AcmeApi) -> MCPServer:
    mcp = MCPServer("acme-mcp-server", version="1.0.0")      # drift point: name positional, everything else keyword

    @mcp.tool(title="Get invoice", annotations=ToolAnnotations(read_only_hint=True, destructive_hint=False, idempotent_hint=True, open_world_hint=True))
    async def acme_get_invoice(
        id: Annotated[str, Field(min_length=1, description='Invoice id, e.g. "inv_123"')],
    ) -> Invoice:
        """Get one invoice by id. Ids come from acme_search_invoices."""
        invoice = await api.get_invoice(id)
        if invoice is None:
            raise ToolError(f'No invoice "{id}". Use acme_search_invoices to find ids.')
        return Invoice(id=invoice.id, total_cents=invoice.total_cents, status=invoice.status)

    return mcp
```

- **Tool definition.** The tool name comes from the function name, the description from the docstring, and the input schema from the type hints. `Annotated[..., Field(...)]` carries descriptions and bounds; `Literal[...]` gives enums. Always call the decorator: `@mcp.tool()`.
- **Optional arguments.** `genre: Annotated[str | None, Field(description="...")] = None`.
- **Return type.** The return annotation *is* the `outputSchema`. A Pydantic model, TypedDict or dataclass becomes `structured_content`, and the SDK adds the JSON text block itself. Scalars and lists are wrapped as `{"result": ...}`.
- **Context.** Add `ctx: Context` (or `Context[MyState]`) to any tool that needs it. It is invisible to the model.
  - `await ctx.report_progress(done, total, message)`
  - `ctx.request_context.lifespan_context`
  - `ctx.headers`, which is `None` on stdio
  - `ctx.protocol_version`
- **Sync tools.** A plain `def` tool runs on a worker thread. Async I/O belongs in `async def`.

## Errors

| Situation | What to do |
|---|---|
| A failure the model can recover from, in a tool | `raise ToolError("<what failed>. <what to try>")`. The client sees `is_error=True` and the text `Error executing tool <name>: <your text>`. |
| An unexpected exception in a tool | Let it raise. The model sees a generic error; the traceback goes to the server log. |
| A protocol-level error (resources, prompts) | `raise MCPError(INVALID_PARAMS, msg)` with `from mcp import MCPError` and `from mcp.types import INVALID_PARAMS` |
| A missing resource | `raise ResourceNotFoundError(uri)`, imported from `mcp.server.mcpserver.exceptions`. The SDK maps it to -32602 with the URI. |

## Logging: drift point

```python
import logging, sys
logging.basicConfig(level=logging.INFO, stream=sys.stderr)   # in __main__ only
logger = logging.getLogger(__name__)                          # everywhere else
```

stdout is the protocol channel on stdio, so nothing in the server writes to it. Protocol logging through `ctx` is deprecated, and the pytest setting `filterwarnings = ["error"]` turns it into a failure.

## Resources and prompts

```python
@mcp.resource("config://app", mime_type="application/json")
def app_config() -> dict:
    return {"region": "eu-west-1"}

@mcp.resource("acme://invoices/{id}", mime_type="application/json")   # template: parameters == {vars}
async def invoice(id: str) -> str:
    return (await api.get_invoice(id)).model_dump_json()

@mcp.prompt(title="Summarize invoice")
def acme_summarize_invoice(id: Annotated[str, Field(description="Invoice id")]) -> str:
    return f"Summarize invoice {id} for a customer email."
```

## Lifespan: shared clients and pools

```python
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

@asynccontextmanager
async def lifespan(server: MCPServer) -> AsyncIterator[AppState]:
    client = await AcmeHttpClient.connect()
    try:
        yield AppState(client=client)
    finally:
        await client.close()

mcp = MCPServer("acme-mcp-server", version="1.0.0", lifespan=lifespan)   # entered once per process
```

## Serving: drift point, copy exactly

Transport settings belong to `run()` (or `streamable_http_app()`), never to the constructor.

```python
mcp.run()                                                     # local: stdio
mcp.run(transport="streamable-http", host="127.0.0.1", port=8000, stateless_http=True)   # remote: http://127.0.0.1:8000/mcp
```

- **`stateless_http=True`** makes legacy-era clients sessionless as well, so the endpoint scales horizontally. Modern clients are always sessionless.
- **Behind a real hostname:** pass `transport_security=TransportSecuritySettings(allowed_hosts=["mcp.example.com", "mcp.example.com:*"])`, imported from `mcp.server.transport_security`. The localhost default otherwise rejects that hostname with 421, and a `0.0.0.0` bind without settings accepts any Host header.
- **Mounting in Starlette or FastAPI.** Mount `mcp.streamable_http_app(stateless_http=True)`, and enter `mcp.session_manager.run()` inside the host app's lifespan. Without that, requests fail with "Task group is not initialized".
- **Launch command.** `python -m acme_mcp` for stdio, and `python -m acme_mcp http` for HTTP; see `templates/python/catalog_mcp/__main__.py`.

## Asking the user mid-call (works in both eras)

```python
from mcp.server.mcpserver import AcceptedElicitation, Elicit, ElicitationResult, Resolve

class Confirm(BaseModel):
    confirm: bool = Field(description="Void the invoice?")

async def ask_confirm(id: str) -> Confirm | Elicit[Confirm]:
    return Elicit(f"Void invoice {id}?", Confirm)

@mcp.tool(annotations=ToolAnnotations(destructive_hint=True))
async def acme_void_invoice(id: str, answer: Annotated[ElicitationResult[Confirm], Resolve(ask_confirm)]) -> str:
    """Void an invoice after the user confirms."""
    if not isinstance(answer, AcceptedElicitation) or not answer.data.confirm:
        return f"Did not void {id}: the user said no."
    await api.void_invoice(id)
    return f"Voided {id}."
```

- **Declines.** Annotating the parameter `ElicitationResult[Confirm]` lets decline and cancel reach the tool, which answers with a normal "did not" reply. With `Annotated[Confirm, Resolve(...)]` the SDK aborts the call on a decline with a generic error ("Resolver for parameter 'confirm' could not resolve: elicitation was decline").

- **Resolved parameters.** A `Resolve(...)` parameter is invisible to the model. The SDK sends the question in the right form for the connection's era.
- **Inside `create_server`.** Define the resolver next to the tool when it needs `api`, and keep `from __future__ import annotations` out of that module: string annotations hide a resolver defined inside a function, and registration fails with `InvalidSignature`.
- **Asking the client instead.** `Sample(...)` asks for an LLM completion and `ListRoots()` for the roots list. Both are deprecated features; prefer calling your LLM provider directly.
- **Deterministic questions.** Build each question only from the tool's arguments and earlier answers, so it comes out the same on every round.

## Cache hints

```python
from mcp.server.caching import CacheHint
MCPServer("acme-mcp-server", version="1.0.0", cache_hints={"tools/list": CacheHint(ttl_ms=60_000, scope="public")})
```

Use these only for results that are identical for every caller; the default is `ttl_ms=0`, `private`.

## Testing: both eras, in memory

Copy `templates/python/tests/test_server.py`. It parametrizes `Client(create_server(fake_api), mode=...)` over:

- `"2026-07-28"`, the modern era;
- `"legacy"`, the 2025 handshake most hosts still use.

`Client(server)` runs in memory with no subprocess and no port. Assert on `result.structured_content` and `result.is_error`; attributes are snake_case.

## Registering with a host

- **Claude Code:** `claude mcp add acme -- /abs/.venv/bin/python -m acme_mcp`
- **Remote:** `claude mcp add --transport http acme https://mcp.example.com/mcp`
- **`mcp dev`:** it opens the Inspector in its default legacy era. Use `scripts/verify_server.mjs` (see `reference/verify.md`), which checks both eras.
