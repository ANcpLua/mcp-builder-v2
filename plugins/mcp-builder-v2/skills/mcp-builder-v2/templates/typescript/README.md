# catalog-mcp-server

MCP server for the Catalog API. SDK v2, spec 2026-07-28; serves modern and legacy clients.

## Tools

| Tool | Purpose | Inputs | Output | read/destr/idem/open | Upstream |
|---|---|---|---|---|---|
| `catalog_search_products` | Search products by name | `query` (1–200), `limit` (1–100, 20), `offset` (≥0) | page of products + `has_more`/`next_offset` | T/F/T/T | `GET /products` |
| `catalog_get_product` | One product by id | `id` | product | T/F/T/T | `GET /products/{id}` |

## Run

```bash
npm install
npm test                 # contract tests, both eras
npm run dev:stdio        # local (stdio)
npm run dev:http         # remote: http://127.0.0.1:3000/mcp  (HOST, PORT, ALLOWED_HOSTS env)
npm run build && node build/src/stdio.js
```

Host registration: `claude mcp add catalog -- node /abs/path/build/src/stdio.js`
