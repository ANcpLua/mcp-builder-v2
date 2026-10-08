# Verify: the four gates

A server is done when gates 1–3 are **GREEN** and gate 4 has a report. Each gate's output has been read rather than assumed. Every gate exercises the modern era explicitly, because the default of every client and tool is legacy, and legacy-only wiring passes legacy checks.

| # | Gate | Command | Proves |
|---|---|---|---|
| 1 | Static | `node <skill>/scripts/check_v2.mjs <project>` | no v1 fingerprints at error severity |
| 2 | Contract tests | `npm test` · `.venv/bin/pytest -q` | tools behave, in both eras, in process |
| 3 | Black box | `node <skill>/scripts/verify_server.mjs ...` | the real process answers both eras; tool schemas are portable; conformance for HTTP |
| 4 | Evaluation | `python <skill>/scripts/evaluation.py ...` | a model can actually use the tools (`reference/evaluation.md`) |

## Gate 1: check_v2

- **Run it** on the project root. It skips `node_modules`, `.venv`, `build` and `dist`.
- **Findings.** Each one prints `path:line`, the rule id, the v1 habit and the v2 form. `silent` marks findings that no compiler or happy-path test would catch.
- **Suppression.** When a finding is a deliberate exception, put `mcp-v2-allow RULE-ID` on that line or the line above, with a reason, for example a legacy-only server kept on purpose.
- **Output.** `--json` gives machine-readable output; `--rules` prints the catalogue.

## Gate 2: contract tests

The templates' tests are the contract.

- **TS** connects through `createMcpHandler(...).fetch` with a modern pin and a default (legacy) client.
- **Python** parametrizes `Client(server, mode=...)` over `"2026-07-28"` and `"legacy"`.

For every tool add one success case asserting `structuredContent`. When the tool has a failure path, also add one recoverable-failure case asserting `isError` and a message naming the next step. Python runs with `filterwarnings = ["error"]`, so deprecated surfaces fail the run.

## Gate 3: verify_server

```bash
# local (stdio): the command goes after --
node <skill>/scripts/verify_server.mjs --cwd <project> -- npx tsx src/stdio.ts
node <skill>/scripts/verify_server.mjs --cwd <project> -- .venv/bin/python -m acme_mcp

# remote (HTTP): --start launches the command, waits until the URL answers, verifies, then stops it
node <skill>/scripts/verify_server.mjs --url http://127.0.0.1:3000/mcp --cwd <project> --start -- npx tsx src/http.ts
node <skill>/scripts/verify_server.mjs --url http://127.0.0.1:8000/mcp --cwd <project> --start -- .venv/bin/python -m acme_mcp http

# remote server that is already running (staging, a container)
node <skill>/scripts/verify_server.mjs --url https://mcp.example.com/mcp
```

Use `env PORT=3101 <command>` to verify on a different port without editing the shell.

It needs Node ≥ 22.19 (Inspector 2.x) and uses the tool versions in `pins.json`.

| Check | RED means |
|---|---|
| modern-era tools/list | the server does not speak 2026-07-28. Nearly always drift point 1 (`reference/drift.md`). |
| legacy-era tools/list | 2025 clients (most hosts today) cannot connect |
| tool-schema portability | the Inspector's `--strict` report found error-severity schema problems some clients reject; the detail line names them |
| conformance server-stateless / tools-list / dns-rebinding-protection | a real spec violation. Checks that need the SDK's test fixtures are reported as `n/a`, and SHOULD-level findings as warnings; neither turns the gate RED. |

**Expected, not a problem:** a SHOULD warning `sep-2575-server-sends-{tools,prompts}-list-changed-on-subscription`. The SDKs advertise `listChanged`, the probe expects a notification after a list mutation, and a server with a fixed tool list never sends one. Act on it only if your server adds or removes tools at runtime; then publish the change (`handler.notify.toolsChanged()` in TS, `ctx.notify_tools_changed()` in Python).

For prompts and resources, add `--with-caching` to run the caching scenario too. It needs tools, prompts and resources all present.

## Exploring by hand

Inspector 2.x, with a config file that pins the era:

```json
{ "mcpServers": {
  "local":  { "command": "npx", "args": ["tsx", "src/stdio.ts"], "cwd": "/abs/project", "protocolEra": "modern" },
  "remote": { "type": "streamable-http", "url": "http://127.0.0.1:3000/mcp", "protocolEra": "modern" } } }
```

```bash
npx -y @modelcontextprotocol/inspector@2.9.0 --cli --config mcp.json --server local --method tools/list
npx -y @modelcontextprotocol/inspector@2.9.0 --cli --config mcp.json --server local --method tools/call --tool-name acme_get_invoice --tool-arg id=inv_1
npx -y @modelcontextprotocol/inspector@2.9.0 --config mcp.json          # web UI
```

A tool returning `isError: true` makes the Inspector CLI print an extra `{"error":{"code":"tool_is_error",…}}` line and exit non-zero. That is the error path working, not a crash.

A modern-era `tools/call` result carries `_meta["io.modelcontextprotocol/serverInfo"]`, so its presence shows the call really went over 2026-07-28. Set `MCP_INSPECTOR_SECRET_STORE=memory` to silence the keychain notice on machines without one.
