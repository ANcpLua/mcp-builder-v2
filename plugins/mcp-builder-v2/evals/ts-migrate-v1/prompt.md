---
max_turns: 120
timeout_seconds: 1800
allowed_tools: [Read, Glob, Grep, Skill, TodoWrite]
expected_outcome: v2 packages, serveStdio entry point, registerTool with z.object schemas.
---

This MCP server is built on an old version of the official MCP TypeScript SDK. Upgrade it to the current SDK and make sure clients that speak the current MCP specification (2026-07-28) can connect to it. Keep its tool working, and make sure it type-checks.
