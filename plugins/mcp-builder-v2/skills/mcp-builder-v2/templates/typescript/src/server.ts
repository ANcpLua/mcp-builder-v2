// Declarative layer: builds one McpServer from dependencies. No transport, no listen, no process access.
// createMcpHandler / serveStdio call this factory once per request / connection — keep it cheap.
import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import { type CatalogApi, matchesQuery, paginate } from './domain.js';

export interface Deps {
    api: CatalogApi;
}

// Hints describe the tool to the host (design.md, "Annotations"). openWorldHint is true because the real
// catalog is an external API; a server over local data sets it to false.
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

const ProductSchema = z.object({
    id: z.string(),
    name: z.string(),
    price_cents: z.number().int()
});

export function createServer({ api }: Deps): McpServer {
    const server = new McpServer({ name: 'catalog-mcp-server', version: '1.0.0' });

    server.registerTool(
        'catalog_search_products',
        {
            title: 'Search products',
            description:
                'Search the product catalog by name substring. Returns a page of products; ' +
                'follow next_offset to read further pages.',
            inputSchema: z.object({
                query: z.string().min(1).max(200).describe('Case-insensitive substring of the product name, e.g. "mug"'),
                limit: z.number().int().min(1).max(100).default(20).describe('Page size (1-100)'),
                offset: z.number().int().min(0).default(0).describe('Items to skip, from a previous next_offset')
            }),
            outputSchema: z.object({
                items: z.array(ProductSchema),
                total: z.number().int(),
                count: z.number().int(),
                offset: z.number().int(),
                has_more: z.boolean(),
                next_offset: z.number().int().nullable()
            }),
            annotations: READ_ONLY
        },
        async ({ query, limit, offset }) => {
            const hits = (await api.listProducts()).filter(p => matchesQuery(p, query));
            const page = paginate(hits, offset, limit);
            const output = {
                ...page,
                items: page.items.map(p => ({ id: p.id, name: p.name, price_cents: p.priceCents }))
            };
            return {
                content: [{ type: 'text', text: JSON.stringify(output) }],
                structuredContent: output
            };
        }
    );

    server.registerTool(
        'catalog_get_product',
        {
            title: 'Get product',
            description: 'Get one product by its id (ids come from catalog_search_products).',
            inputSchema: z.object({ id: z.string().min(1).describe('Product id, e.g. "p-002"') }),
            outputSchema: ProductSchema,
            annotations: READ_ONLY
        },
        async ({ id }) => {
            const product = await api.getProduct(id);
            if (!product) {
                return {
                    content: [{ type: 'text', text: `No product with id "${id}". Use catalog_search_products to find valid ids.` }],
                    isError: true
                };
            }
            const output = { id: product.id, name: product.name, price_cents: product.priceCents };
            return { content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: output };
        }
    );

    return server;
}
