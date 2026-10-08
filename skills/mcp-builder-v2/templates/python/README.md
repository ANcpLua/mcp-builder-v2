# catalog-mcp-server

MCP server for the Catalog API. `mcp` 2.x, spec 2026-07-28; serves modern and legacy clients.

## Tools

| Tool | Purpose | Inputs | Output | read/destr/idem/open | Upstream |
|---|---|---|---|---|---|
| `catalog_search_products` | Search products by name | `query` (1–200), `limit` (1–100, 20), `offset` (≥0) | page of products + `has_more`/`next_offset` | T/F/T/T | `GET /products` |
| `catalog_get_product` | One product by id | `id` | product | T/F/T/T | `GET /products/{id}` |

## Run

```bash
python -m venv .venv && .venv/bin/pip install -e ".[dev]"
.venv/bin/pytest -q                      # contract tests, both eras
.venv/bin/python -m catalog_mcp          # local (stdio)
.venv/bin/python -m catalog_mcp http     # remote: http://127.0.0.1:8000/mcp  (HOST, PORT, ALLOWED_HOSTS env)
```

Host registration: `claude mcp add catalog -- /abs/.venv/bin/python -m catalog_mcp`
