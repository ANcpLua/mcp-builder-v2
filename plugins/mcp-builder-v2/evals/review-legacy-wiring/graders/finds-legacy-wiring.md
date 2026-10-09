---
type: llm
focus: last_message
weight: 3
---

PASS if the response says that clients speaking 2026-07-28 cannot connect (or that the server only serves 2025-era / legacy clients), names `server.connect(new StdioServerTransport())` (or the StdioServerTransport wiring) as the cause, and recommends `serveStdio` (a factory-based stdio entry point) as the fix.
FAIL if the response says the server is ready for 2026-07-28 clients, or does not identify the stdio wiring as the problem.
