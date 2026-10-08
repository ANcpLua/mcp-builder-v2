// Imperative shell: builds the real dependencies once per process. The only module that reads the environment.
// Replace the sample with your adapter: an HTTP client, a database pool, a file read — anything that does I/O
// and implements the CatalogApi interface from domain.ts. Both entry points (stdio.ts, http.ts) import this.
import { type CatalogApi, inMemoryCatalog } from './domain.js';
import type { Deps } from './server.js';

export function loadDeps(env: NodeJS.ProcessEnv = process.env): Deps {
    void env; // e.g. new HttpCatalog(env.CATALOG_URL, env.CATALOG_TOKEN)
    const api: CatalogApi = inMemoryCatalog([
        { id: 'p-001', name: 'Espresso cup', priceCents: 1200 },
        { id: 'p-002', name: 'Travel mug', priceCents: 2400 },
        { id: 'p-003', name: 'Mug rack', priceCents: 3600 }
    ]);
    return { api };
}
