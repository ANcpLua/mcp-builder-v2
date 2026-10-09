"""Imperative shell: the only place that reads the environment, builds dependencies, and binds stdio or a port.

The serving lines in main() are fixed; configure with HOST, PORT, ALLOWED_HOSTS and change load_api().

    python -m catalog_mcp            # stdio (local)
    python -m catalog_mcp http       # Streamable HTTP on 127.0.0.1:8000/mcp (remote)
"""

from __future__ import annotations

import logging
import os
import sys

from mcp.server.transport_security import TransportSecuritySettings

from .domain import CatalogApi, InMemoryCatalog, Product
from .server import create_server

logging.basicConfig(level=logging.INFO, stream=sys.stderr)  # stdout is the protocol channel on stdio


def load_api() -> CatalogApi:
    """Build the real dependency. Replace with your adapter (HTTP client, DB, file read) reading os.environ."""
    return InMemoryCatalog(
        (
            Product("p-001", "Espresso cup", 1200),
            Product("p-002", "Travel mug", 2400),
            Product("p-003", "Mug rack", 3600),
        )
    )


mcp = create_server(load_api())


def main() -> None:
    transport = sys.argv[1] if len(sys.argv) > 1 else "stdio"
    if transport == "stdio":
        mcp.run()
        return
    if transport != "http":
        raise SystemExit(f"unknown transport {transport!r}; use 'stdio' or 'http'")
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8000"))
    allowed = [h for h in os.environ.get("ALLOWED_HOSTS", "").split(",") if h]
    security = (
        TransportSecuritySettings(allowed_hosts=[*allowed, *(f"{h}:*" for h in allowed)]) if allowed else None
    )
    mcp.run(transport="streamable-http", host=host, port=port, stateless_http=True, transport_security=security)


if __name__ == "__main__":
    main()
