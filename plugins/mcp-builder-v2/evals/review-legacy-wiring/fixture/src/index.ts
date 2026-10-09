import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

const notes = new Map<string, string>([['welcome', 'Read the README first.']]);

const server = new McpServer({ name: 'notes-mcp-server', version: '2.0.0' });

server.registerTool('notes_get', { description: 'Get a note by id', inputSchema: z.object({ id: z.string() }) }, async ({ id }) => {
    const note = notes.get(id);
    if (!note) return { content: [{ type: 'text', text: `No note "${id}"` }], isError: true };
    return { content: [{ type: 'text', text: note }] };
});

await server.connect(new StdioServerTransport());
console.error('notes-mcp-server running on stdio');
