// Functional core: no MCP imports, no I/O. Types, pure helpers, and the interface of the service API.
// Real implementations of that interface (HTTP clients, DB, files) are adapters built in deps.ts.

export interface Product {
    id: string;
    name: string;
    priceCents: number;
}

/** The only I/O seam. deps.ts builds the real implementation; tests pass a fake. */
export interface CatalogApi {
    listProducts(): Promise<Product[]>;
    getProduct(id: string): Promise<Product | undefined>;
}

export interface Page<T> {
    items: T[];
    total: number;
    count: number;
    offset: number;
    has_more: boolean;
    next_offset: number | null;
}

export function paginate<T>(all: readonly T[], offset: number, limit: number): Page<T> {
    const items = all.slice(offset, offset + limit);
    const end = offset + items.length;
    return {
        items,
        total: all.length,
        count: items.length,
        offset,
        has_more: end < all.length,
        next_offset: end < all.length ? end : null
    };
}

export function matchesQuery(product: Product, query: string): boolean {
    return product.name.toLowerCase().includes(query.trim().toLowerCase());
}

export function inMemoryCatalog(products: readonly Product[]): CatalogApi {
    return {
        listProducts: async () => [...products],
        getProduct: async id => products.find(p => p.id === id)
    };
}
