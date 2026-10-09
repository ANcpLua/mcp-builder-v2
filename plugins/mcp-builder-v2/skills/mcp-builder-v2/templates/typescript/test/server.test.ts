// Contract test: drives the real factory through the real HTTP handler, in process, in BOTH protocol eras.
// Per tool: one success test, plus one recoverable-failure test when the tool has a failure path.
// The data below is a test fake, independent of deps.ts.
import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createMcpHandler } from '@modelcontextprotocol/server';

import { inMemoryCatalog } from '../src/domain.js';
import { createServer } from '../src/server.js';

const api = inMemoryCatalog([
    { id: 'p-001', name: 'Espresso cup', priceCents: 1200 },
    { id: 'p-002', name: 'Travel mug', priceCents: 2400 },
    { id: 'p-003', name: 'Mug rack', priceCents: 3600 }
]);

const handler = createMcpHandler(() => createServer({ api }));
after(() => handler.close());

async function connect(era: 'modern' | 'legacy'): Promise<Client> {
    const transport = new StreamableHTTPClientTransport(new URL('http://test.local/mcp'), {
        fetch: (url, init) => handler.fetch(new Request(url, init))
    });
    const options = era === 'modern' ? { versionNegotiation: { mode: { pin: '2026-07-28' as const } } } : {};
    const client = new Client({ name: 'contract-test', version: '1.0.0' }, options);
    await client.connect(transport);
    assert.equal(client.getProtocolEra(), era);
    return client;
}

for (const era of ['modern', 'legacy'] as const) {
    describe(`${era} era`, () => {
        test('lists tools with schemas and annotations', async () => {
            const client = await connect(era);
            const { tools } = await client.listTools();
            assert.deepEqual(
                tools.map(t => t.name),
                ['catalog_search_products', 'catalog_get_product']
            );
            for (const tool of tools) {
                assert.ok(tool.outputSchema, `${tool.name} has outputSchema`);
                assert.equal(tool.annotations?.readOnlyHint, true);
            }
            await client.close();
        });

        test('returns structured content and paginates', async () => {
            const client = await connect(era);
            const result = await client.callTool({ name: 'catalog_search_products', arguments: { query: 'mug', limit: 1 } });
            assert.equal(result.isError, undefined);
            assert.deepEqual(result.structuredContent, {
                items: [{ id: 'p-002', name: 'Travel mug', price_cents: 2400 }],
                total: 2,
                count: 1,
                offset: 0,
                has_more: true,
                next_offset: 1
            });
            await client.close();
        });

        test('gets one product by id', async () => {
            const client = await connect(era);
            const result = await client.callTool({ name: 'catalog_get_product', arguments: { id: 'p-003' } });
            assert.deepEqual(result.structuredContent, { id: 'p-003', name: 'Mug rack', price_cents: 3600 });
            await client.close();
        });

        test('reports a recoverable error the model can read', async () => {
            const client = await connect(era);
            const result = await client.callTool({ name: 'catalog_get_product', arguments: { id: 'nope' } });
            assert.equal(result.isError, true);
            assert.match(JSON.stringify(result.content), /catalog_search_products/);
            await client.close();
        });
    });
}
