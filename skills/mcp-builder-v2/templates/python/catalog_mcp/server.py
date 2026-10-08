"""Declarative layer: builds one MCPServer from dependencies. No transport, no ports, no env reads.

No `from __future__ import annotations` in this file: a Resolve(...) resolver defined inside create_server
is a closure, and string annotations would hide it from the SDK (InvalidSignature at registration).
"""

from typing import Annotated

from pydantic import BaseModel, Field

from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations

from .domain import CatalogApi, matches_query, window

# Hints describe the tool to the host (design.md, "Annotations"). open_world_hint is True because the real
# catalog is an external API; a server over local data sets it to False.
READ_ONLY = ToolAnnotations(read_only_hint=True, destructive_hint=False, idempotent_hint=True, open_world_hint=True)


class ProductOut(BaseModel):
    id: str
    name: str
    price_cents: int


class ProductPage(BaseModel):
    items: list[ProductOut]
    total: int
    count: int
    offset: int
    has_more: bool
    next_offset: int | None


def create_server(api: CatalogApi) -> MCPServer:
    mcp = MCPServer("catalog-mcp-server", version="1.0.0")

    @mcp.tool(title="Search products", annotations=READ_ONLY)
    async def catalog_search_products(
        query: Annotated[str, Field(min_length=1, max_length=200, description='Case-insensitive substring of the product name, e.g. "mug"')],
        limit: Annotated[int, Field(ge=1, le=100, description="Page size (1-100)")] = 20,
        offset: Annotated[int, Field(ge=0, description="Items to skip, from a previous next_offset")] = 0,
    ) -> ProductPage:
        """Search the product catalog by name substring. Returns a page of products; follow next_offset to read further pages."""
        hits = [p for p in await api.list_products() if matches_query(p, query)]
        w = window(len(hits), offset, limit)
        items = [ProductOut(id=p.id, name=p.name, price_cents=p.price_cents) for p in hits[w.start : w.end]]
        return ProductPage(
            items=items, total=w.total, count=len(items), offset=w.start, has_more=w.has_more, next_offset=w.next_offset
        )

    @mcp.tool(title="Get product", annotations=READ_ONLY)
    async def catalog_get_product(
        id: Annotated[str, Field(min_length=1, description='Product id, e.g. "p-002"')],
    ) -> ProductOut:
        """Get one product by its id (ids come from catalog_search_products)."""
        product = await api.get_product(id)
        if product is None:
            raise ToolError(f'No product with id "{id}". Use catalog_search_products to find valid ids.')
        return ProductOut(id=product.id, name=product.name, price_cents=product.price_cents)

    return mcp
