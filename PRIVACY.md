# Privacy

mcp-builder-v2 collects no data. It has no hooks, no MCP servers, no analytics and no telemetry, and it sends nothing to the maintainer.

Its scripts run only when you or Claude invoke them:

- `check_v2.mjs` reads files in your project and prints its findings locally.
- `verify_server.mjs` starts or connects to the MCP server you point it at, and runs the MCP Inspector and the conformance tool through `npx`, which downloads them from the npm registry.
- `check_pins.mjs --online` asks the npm registry and PyPI for current versions.
- `evaluation.py` sends prompts and your server's tool results to the Anthropic API, using your own `ANTHROPIC_API_KEY`.
- `ci/weekly.mjs`, the maintainer's regression check, exports its run telemetry only when an OTLP endpoint is configured. It is off by default.

npm, PyPI and Anthropic handle those requests under their own privacy policies.

Questions: https://github.com/ANcpLua/mcp-builder-v2/issues
