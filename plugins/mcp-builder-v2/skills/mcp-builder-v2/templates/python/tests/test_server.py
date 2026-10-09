"""Contract test: drives the real server in memory through the real Client, in BOTH protocol eras.

Per tool: one success test, plus one recoverable-failure test when the tool has a failure path.
FAKE is test data, independent of __main__.load_api().
"""

from __future__ import annotations

import pytest

from mcp import Client
from mcp.types import TextContent

from catalog_mcp.domain import InMemoryCatalog, Product
from catalog_mcp.server import create_server

FAKE = InMemoryCatalog(
    (
        Product("p-001", "Espresso cup", 1200),
        Product("p-002", "Travel mug", 2400),
        Product("p-003", "Mug rack", 3600),
    )
)

ERAS = {"modern": ("2026-07-28", "2026-07-28"), "legacy": ("legacy", "2025-11-25")}


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture(params=sorted(ERAS))
async def client(request: pytest.FixtureRequest):
    mode, expected_version = ERAS[request.param]
    async with Client(create_server(FAKE), mode=mode, raise_exceptions=True) as c:
        assert c.protocol_version == expected_version
        yield c


@pytest.mark.anyio
async def test_lists_tools_with_schemas_and_annotations(client: Client) -> None:
    tools = (await client.list_tools()).tools
    assert [t.name for t in tools] == ["catalog_search_products", "catalog_get_product"]
    for tool in tools:
        assert tool.output_schema is not None
        assert tool.annotations is not None and tool.annotations.read_only_hint is True


@pytest.mark.anyio
async def test_returns_structured_content_and_paginates(client: Client) -> None:
    result = await client.call_tool("catalog_search_products", {"query": "mug", "limit": 1})
    assert result.is_error is False
    assert result.structured_content == {
        "items": [{"id": "p-002", "name": "Travel mug", "price_cents": 2400}],
        "total": 2,
        "count": 1,
        "offset": 0,
        "has_more": True,
        "next_offset": 1,
    }


@pytest.mark.anyio
async def test_gets_one_product_by_id(client: Client) -> None:
    result = await client.call_tool("catalog_get_product", {"id": "p-003"})
    assert result.structured_content == {"id": "p-003", "name": "Mug rack", "price_cents": 3600}


@pytest.mark.anyio
async def test_reports_a_recoverable_error_the_model_can_read(client: Client) -> None:
    result = await client.call_tool("catalog_get_product", {"id": "nope"})
    assert result.is_error is True
    text = " ".join(b.text for b in result.content if isinstance(b, TextContent))
    assert "catalog_search_products" in text
