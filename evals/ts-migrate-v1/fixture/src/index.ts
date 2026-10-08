import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const notes = new Map<string, string>([['welcome', 'Read the README first.']]);

const server = new McpServer({ name: 'notes-mcp-server', version: '1.0.0' });

server.tool('notes_get', 'Get a note by id', { id: z.string() }, async ({ id }) => {
    const note = notes.get(id);
    if (!note) return { content: [{ type: 'text', text: `No note "${id}"` }], isError: true };
    return { content: [{ type: 'text', text: note }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('notes-mcp-server running on stdio');
