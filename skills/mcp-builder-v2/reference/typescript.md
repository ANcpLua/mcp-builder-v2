# TypeScript: the v2 way (`@modelcontextprotocol/server` 2.x)

Every snippet here ran against the versions in `pins.json`. The runnable whole is `templates/typescript/`; start there and change it, rather than writing SDK calls from memory. Sections marked **drift point** are where recall produces v1 code that still compiles; copy those lines exactly.

Live docs, for anything not covered: `https://ts.sdk.modelcontextprotocol.io/v2/llms.txt` (every page also exists as `.md`). A page that imports from `@modelcontextprotocol/sdk` is v1 documentation, so close it and use the v2 site.

## Project

```
package.json        "type": "module"; deps from pins.json
tsconfig.json       NodeNext, strict, "types": ["node"] (TypeScript >= 6 adds no @types by default)
src/domain.ts       functional core: types, pure helpers, the CatalogApi interface. No I/O, no MCP imports.
src/server.ts       createServer(deps): McpServer — registers everything. No transport, no env.
src/deps.ts         imperative shell: loadDeps() builds the real adapter from env (yours to write)
src/stdio.ts        imperative shell, local:  serveStdio(() => createServer(deps))           (fixed)
src/http.ts         imperative shell, remote: createMcpHandler(() => createServer(deps))     (fixed)
test/server.test.ts contract test through the real handler with a fake data source, both eras
```

Scripts: `npm test`, `npm run typecheck`, `npm run build`, `npm run dev:stdio`, `npm run dev:http`.

## Server and tools

```ts
import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';                                   // drift point: the zod/v4 subpath, zod ^4.2

export function createServer({ api }: Deps): McpServer {
    const server = new McpServer({ name: 'acme-mcp-server', version: '1.0.0' });

    server.registerTool(
        'acme_get_invoice',
        {
            title: 'Get invoice',
            description: 'Get one invoice by id. Ids come from acme_search_invoices.',
            inputSchema: z.object({                            // drift point: always z.object(...)
                id: z.string().min(1).describe('Invoice id, e.g. "inv_123"')
            }),
            outputSchema: z.object({ id: z.string(), total_cents: z.number().int(), status: z.enum(['open', 'paid']) }),
            annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
        },
        async ({ id }, ctx) => {                               // drift point: the second parameter is ctx
            const invoice = await api.getInvoice(id, { signal: ctx.mcpReq.signal });
            if (!invoice) {
                return { content: [{ type: 'text', text: `No invoice "${id}". Use acme_search_invoices to find ids.` }], isError: true };
            }
            const output = { id: invoice.id, total_cents: invoice.totalCents, status: invoice.status };
            return { content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: output };
        }
    );
    return server;
}
```

- **Arguments.** One Zod object per tool. `.describe()` on every field is the only documentation the model gets for it. The SDK validates arguments before the handler runs; failures reach the model as an `isError` result.
- **Optional arguments.** Use `.optional()` or `.default(v)`. `.refine()` rules are not part of the advertised JSON Schema, so check cross-field rules in the handler and return `isError`.
- **Output.** With `outputSchema`, return `structuredContent` and the same object as JSON text in `content`. The SDK validates `structuredContent` against the schema.
- **A tool with no arguments.** Omit `inputSchema`; the handler then receives `ctx` as its only parameter.
- **Other content.** Use blocks: `{ type: 'image' | 'audio', data: base64, mimeType }`, `{ type: 'resource', resource: { uri, mimeType, text } }`, `{ type: 'resource_link', uri, name }`.
- **`ctx` reference.**
  - `ctx.mcpReq.signal`: AbortSignal; pass it to fetch.
  - `ctx.mcpReq.id`
  - `ctx.mcpReq._meta`
  - `ctx.mcpReq.envelope`: per-request client info and capabilities.
  - `ctx.mcpReq.inputResponses`, `ctx.mcpReq.requestState<T>()`: see "Asking the user" below.
  - `ctx.http?.authInfo`, `ctx.http?.req`: undefined on stdio.

## Errors

| Situation | What to do |
|---|---|
| A failure the model can recover from (not found, bad combination, upstream 4xx/5xx) in a tool | `return { content: [{ type: 'text', text: '<what failed>. <what to try>' }], isError: true }` |
| An unexpected exception in a tool | Let it throw. The SDK turns it into `isError: true` carrying the message. |
| A bad request to a resource, prompt or completion | `throw new ProtocolError(ProtocolErrorCode.InvalidParams, msg)` |
| A missing resource | `throw new ResourceNotFoundError(uri.href)` (code -32602) |

`ProtocolError`, `ProtocolErrorCode` and `ResourceNotFoundError` are imported from `@modelcontextprotocol/server`.

## Resources and prompts

```ts
import { ResourceTemplate } from '@modelcontextprotocol/server';

server.registerResource('config', 'config://app', { title: 'App config', mimeType: 'application/json' }, async uri => ({
    contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(config) }]
}));

server.registerResource(
    'invoice',
    new ResourceTemplate('acme://invoices/{id}', { list: undefined }),
    { description: 'One invoice as JSON', mimeType: 'application/json' },
    async (uri, { id }) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await api.getInvoice(String(id))) }] })
);

server.registerPrompt(
    'acme_summarize_invoice',
    { title: 'Summarize invoice', description: 'Summarize one invoice for a customer email', argsSchema: z.object({ id: z.string() }) },
    ({ id }) => ({ messages: [{ role: 'user' as const, content: { type: 'text' as const, text: `Summarize invoice ${id}.` } }] })
);
```

`registerResource` always takes a metadata object; pass `{}` when there is none.

## Serving: drift point, copy exactly

Both entry points take a **factory**, `() => createServer(deps)`. That factory is what lets one server answer both eras.

**Local (stdio):**

```ts
import { serveStdio } from '@modelcontextprotocol/server/stdio';
const handle = serveStdio(() => createServer({ api }));
console.error('acme-mcp-server: serving on stdio');            // stderr only; stdout carries the protocol
process.on('SIGINT', () => void handle.close());
```

**Remote, on Node (Express):**

```ts
import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';

const handler = createMcpHandler(() => createServer({ api }));          // runs per request; keep it cheap
const app = createMcpExpressApp({ host });                               // Host/Origin guard on for localhost binds
const node = toNodeHandler(handler);
app.all('/mcp', (req, res) => void node(req, res, req.body));
app.listen(port, host);
```

- **Hostnames.** When binding `0.0.0.0` behind a real hostname, use `createMcpExpressApp({ host: '0.0.0.0', allowedHosts: ['mcp.example.com'] })`.
- **Expensive objects.** Build pools, API clients and caches once at module scope. The factory only closes over them.
- **Web-standard runtimes** (Workers, Deno, Bun): `export default handler`. Put `hostHeaderValidationResponse` and `originValidationResponse` (from `@modelcontextprotocol/server`) in front of `handler.fetch` when the server is reachable from a browser.
- **Response shape.** `createMcpHandler(factory, { responseMode: 'json' })` never streams, and drops progress notifications. Keep the default unless a proxy breaks SSE.
- **Legacy clients.** The default `legacy: 'stateless'` keeps 2025-era clients working; leave it.

**Auth (remote).** Verify the bearer token in front of the handler with `requireBearerAuth({ verifier })` from `@modelcontextprotocol/express`. Tools then read `ctx.http?.authInfo`. Serve Protected Resource Metadata (RFC 9728) using the `mcpAuthMetadataRouter` helpers. The authorization server itself is an external IdP, never this process. Full recipe: `serving/authorization.md` in the v2 docs.

## Asking the user mid-call (MRTR)

A tool asks by *returning* `input_required`; the client answers and retries the call. The handler is written to run once per round.

```ts
import type { CallToolResult, InputRequiredResult } from '@modelcontextprotocol/server';
import { acceptedContent, inputRequired, inputResponse } from '@modelcontextprotocol/server';

const Confirm = z.object({ confirm: z.boolean() });

server.registerTool('acme_void_invoice', { description: 'Void an invoice after the user confirms', inputSchema: z.object({ id: z.string() }),
    annotations: { destructiveHint: true } },
    async ({ id }, ctx): Promise<CallToolResult | InputRequiredResult> => {
        if (inputResponse(ctx.mcpReq.inputResponses, 'confirm').kind === 'missing') {   // not asked yet: ask
            return inputRequired({ inputRequests: { confirm: inputRequired.elicit({ message: `Void ${id}?`, requestedSchema: Confirm }) } });
        }
        const answer = acceptedContent(ctx.mcpReq.inputResponses, 'confirm', Confirm);   // undefined on decline, cancel or bad content
        if (answer?.confirm !== true) {
            return { content: [{ type: 'text', text: `Did not void ${id}: the user said no.` }] };
        }
        await api.voidInvoice(id);
        return { content: [{ type: 'text', text: `Voided ${id}` }] };
    });
```

- **Ask once (drift point).** Re-asking whenever `acceptedContent` is `undefined` (the shape of the SDK's own doc example) re-shows the dialog after every decline: the user sees it 8–10 times, then the call fails with "still required input after 10 rounds". Ask only while `inputResponse(...)` is `missing`; any answer ends the call.

- **Elicitation schemas** are flat objects of primitives: strings (including the email, uri, date and date-time formats), numbers with inclusive bounds, booleans, enums, `.optional()` and `.default()`.
- **More than one round.** `inputResponses` holds only the current round's answers. Carry everything learned so far in `requestState`, minted by `createRequestStateCodec({ key })`. The key is at least 32 bytes and shared across replicas. Set `new McpServer(info, { requestState: { verify: codec.verify } })`, and read the state back with `ctx.mcpReq.requestState<T>()`.
- **Eras.** This works fully for modern clients and over stdio for legacy clients, where the SDK shim pushes real requests. On stateless HTTP, legacy clients get an `isError` refusal.

## Cache hints

Set these only when a result is the same for every caller:

```ts
new McpServer({ name, version }, { cacheHints: { 'tools/list': { ttlMs: 60_000, cacheScope: 'public' } } });
```

The default is `ttlMs: 0` with `cacheScope: 'private'`. Anything derived from the caller's auth must stay `'private'`.

## Testing: both eras, in process

Copy `templates/typescript/test/server.test.ts`. It drives `createMcpHandler(...).fetch` through a real `Client` twice:

- **Modern run:** `versionNegotiation: { mode: { pin: '2026-07-28' } }`. This is the run that catches wiring that only serves 2025.
- **Legacy run:** no options; the TS `Client` defaults to the 2025 handshake.

Assert on `structuredContent` and on `isError`. Run with `npm test` (`node --import tsx --test`).

## Registering with a host

- **Claude Code:** `claude mcp add acme -- node /abs/path/build/src/stdio.js`
- **Remote:** `claude mcp add --transport http acme https://mcp.example.com/mcp`
- **Inspector**, by hand: see `reference/verify.md`. Set `"protocolEra": "modern"`, because the Inspector defaults to legacy.
