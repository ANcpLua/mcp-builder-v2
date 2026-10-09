# mcp-builder-v2

The **MCP Builder v2** plugin for Claude: build, migrate and check MCP servers on SDK v2 and spec 2026-07-28, in TypeScript or Python.

- **The plugin:** [`plugins/mcp-builder-v2/`](plugins/mcp-builder-v2/): what it does, example prompts, results, privacy.
- **Install in Claude Code:** `/plugin install mcp-builder-v2 --marketplace ANcpLua/mcp-builder-v2`
- **Security:** [`SECURITY.md`](.github/SECURITY.md). **Questions and bugs:** [issues](https://github.com/ANcpLua/mcp-builder-v2/issues).

## Repository layout

| Path | What it is |
|---|---|
| `plugins/mcp-builder-v2/` | The plugin, exactly as users install it: manifest, skill, eval suite, README, privacy policy |
| `.claude-plugin/marketplace.json` | Marketplace entry, so the install line above works |
| `ci/` | The maintainer's regression check (not part of the plugin) |
| `.github/workflows/` | CI on every push, and the weekly model evals |

## Maintenance

- **Every push** (GitHub Actions, no model usage): drift-rule self-tests, both templates in both eras, `verify_server`, and registry news.
- **Weekly** (`.github/workflows/evals.yml`, on API credits, pinned to Opus 5.5): `node ci/weekly.mjs` runs the same checks plus `claude plugin eval`, capped at $20 per run. The same script also runs as a scheduled task on a Claude plan, where it adds a precision canary (`check_v2` on an independently written v2 server): `ci/SCHEDULED_TASK.md`. It can export its run telemetry to an OTLP endpoint, only when `QYL_OTLP_ENDPOINT` or `OTEL_EXPORTER_OTLP_ENDPOINT` is set.
- **On any SDK or spec release, or at least every 90 days:** follow `plugins/mcp-builder-v2/skills/mcp-builder-v2/reference/maintenance.md`. `pins.json` records `verified_on`.

## License

Apache-2.0.
