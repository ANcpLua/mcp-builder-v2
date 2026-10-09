// Imperative shell (local): the only place that touches stdin/stdout. Log with console.error only.
// The SDK lines are fixed; change only how deps are built (deps.ts).
import { serveStdio } from '@modelcontextprotocol/server/stdio';

import { loadDeps } from './deps.js';
import { createServer } from './server.js';

const deps = loadDeps();
const handle = serveStdio(() => createServer(deps));
console.error('catalog-mcp-server: serving on stdio');

process.on('SIGINT', () => void handle.close());
