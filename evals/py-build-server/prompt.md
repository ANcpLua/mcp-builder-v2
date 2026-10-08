---
max_turns: 150
timeout_seconds: 2400
allowed_tools: [Read, Glob, Grep, Skill, TodoWrite]
expected_outcome: mcp>=2,<3; MCPServer; stateless Streamable HTTP; no FastMCP, no SSE.
---

Build an MCP server in Python, in the current directory, using the official MCP Python SDK and the current MCP specification.

It exposes the library dataset in ./data/library.json (authors, books, members, loans) through four tools:
- search books by title substring, genre or author name, paginated
- get one book with its author
- list a member's loans, optionally only the unreturned ones
- get an author together with their books

It must run locally over stdio and remotely over Streamable HTTP.

Layout: pyproject.toml at the root, a package named library_mcp, the tools registered in library_mcp/server.py, and the entry point in library_mcp/__main__.py (stdio by default, Streamable HTTP when started with the argument `http`). Create a virtual environment in .venv, install the project into it, and make sure the package imports.
