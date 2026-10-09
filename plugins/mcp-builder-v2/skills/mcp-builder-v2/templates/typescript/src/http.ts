// Imperative shell (remote): the only place that binds a port. Stateless — scales horizontally as-is.
// The SDK lines are fixed; configure with HOST, PORT, ALLOWED_HOSTS and change how deps are built (deps.ts).
import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';

import { loadDeps } from './deps.js';
import { createServer } from './server.js';

const deps = loadDeps();
const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 3000);
const allowedHosts = process.env.ALLOWED_HOSTS?.split(',').filter(Boolean);

const handler = createMcpHandler(() => createServer(deps));
const app = createMcpExpressApp(allowedHosts ? { host, allowedHosts } : { host });
const node = toNodeHandler(handler);
app.all('/mcp', (req, res) => void node(req, res, req.body));

const server = app.listen(port, host, () => console.error(`catalog-mcp-server: http://${host}:${port}/mcp`));

async function shutdown(): Promise<void> {
    await handler.close();
    server.close();
    process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
