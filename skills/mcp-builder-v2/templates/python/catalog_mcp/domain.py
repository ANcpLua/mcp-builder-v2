"""Functional core: no MCP imports, no I/O. Types, pure helpers, and the protocol of the service API.

Real implementations of that protocol (HTTP clients, DB, files) are adapters built in __main__.py.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class Product:
    id: str
    name: str
    price_cents: int


class CatalogApi(Protocol):
    """The only I/O seam. __main__.py builds the real implementation; tests pass a fake."""

    async def list_products(self) -> list[Product]: ...

    async def get_product(self, product_id: str) -> Product | None: ...


@dataclass(frozen=True)
class Window:
    start: int
    end: int
    total: int

    @property
    def has_more(self) -> bool:
        return self.end < self.total

    @property
    def next_offset(self) -> int | None:
        return self.end if self.has_more else None


def window(total: int, offset: int, limit: int) -> Window:
    start = min(offset, total)
    return Window(start=start, end=min(start + limit, total), total=total)


def matches_query(product: Product, query: str) -> bool:
    return query.strip().lower() in product.name.lower()


@dataclass(frozen=True)
class InMemoryCatalog:
    products: Sequence[Product]

    async def list_products(self) -> list[Product]:
        return list(self.products)

    async def get_product(self, product_id: str) -> Product | None:
        return next((p for p in self.products if p.id == product_id), None)
