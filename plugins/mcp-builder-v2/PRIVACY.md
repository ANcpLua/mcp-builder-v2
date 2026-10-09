# Privacy

mcp-builder-v2 collects no personal data and sends nothing to its maintainer. It has no hooks, no MCP servers, no analytics and no telemetry.

## What runs, and what it contacts

Its scripts run on your machine, only when you or Claude invoke them:

- `check_v2.mjs` reads files in your project and prints its findings locally. It contacts nothing.
- `verify_server.mjs` starts or connects to the MCP server you point it at. It runs the MCP Inspector and the MCP conformance tool through `npx` at the exact versions in `pins.json`, which downloads them from the npm registry.
- `check_pins.mjs --online` asks the npm registry and PyPI for current versions.
- `evaluation.py` sends its prompts and your server's tool results to the Anthropic API, using your own `ANTHROPIC_API_KEY`.
- The skill's scaffold step has Claude run `npm install` or `pip install` in your new project, which fetches the template's dependencies from the npm registry or PyPI.

npm, PyPI and Anthropic handle those requests under their own privacy policies.

## Storage and retention

The plugin keeps no data of its own. Its scripts print to your terminal and write only temporary files, which `verify_server.mjs` deletes when it finishes, and the output you ask for, such as an evaluation report (`-o`). That output stays on your machine until you delete it.

## Contact

Questions: https://github.com/ANcpLua/mcp-builder-v2/issues
