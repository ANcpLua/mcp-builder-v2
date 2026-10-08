---
max_turns: 150
timeout_seconds: 2400
allowed_tools: [Read, Glob, Grep, Skill, TodoWrite]
expected_outcome: SDK v2 packages; serveStdio and createMcpHandler entry points; no sessions.
---

Build an MCP server in TypeScript, in the current directory, using the official MCP TypeScript SDK and the current MCP specification.

It exposes the library dataset in ./data/library.json (authors, books, members, loans) through four tools:
- search books by title substring, genre or author name, paginated
- get one book with its author
- list a member's loans, optionally only the unreturned ones
- get an author together with their books

It must run locally over stdio and remotely over Streamable HTTP.

Layout: package.json at the root, the tools registered in src/server.ts, the stdio entry point in src/stdio.ts, the HTTP entry point in src/http.ts. Install the dependencies and make sure it type-checks.
