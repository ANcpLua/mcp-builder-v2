---
max_turns: 60
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Skill, TodoWrite]
expected_outcome: Identifies server.connect(new StdioServerTransport()) as legacy-only and recommends serveStdio.
---

We upgraded this MCP server to the new SDK and want to ship it. Review it: can clients that speak the current MCP specification (2026-07-28) connect to it? Tell me what, if anything, has to change before we ship.
