# MCP Builder v2

Build, migrate and check MCP servers on **SDK v2** (`@modelcontextprotocol/server` 2.x, Python `mcp` 2.x) and **spec 2026-07-28**, in TypeScript or Python.

Most published MCP code predates SDK v2, so servers written from memory drift to v1 patterns. In TypeScript that drift compiles against the v2 packages, passes the default Inspector and a default-client test, and then fails every client speaking 2026-07-28. This plugin builds from runnable templates and proves the result against clients of both protocol eras.

## Example prompts

- "Build a TypeScript MCP server for our orders API: stdio for Claude Desktop, Streamable HTTP for remote clients."
- "Migrate this server from `@modelcontextprotocol/sdk` 1.x to SDK v2, and make sure 2026-07-28 clients can connect."
- "Check this Python MCP server for v1 drift and tell me what 2026-07-28 clients will fail on."
- "Add a tool that asks the user to confirm before it deletes a record."
- "Write ten evaluation questions for my MCP server and run them."

The skill can also be invoked directly as `/mcp-builder-v2:mcp-builder-v2`.

## Install

Claude Code: `/plugin install mcp-builder-v2 --marketplace ANcpLua/mcp-builder-v2`

Requirements: Node ≥ 20 (`verify_server` needs ≥ 22.19 for Inspector 2.x), and Python ≥ 3.10 for Python servers and the evaluation harness.

## What's inside

One skill, `mcp-builder-v2`, with:

- **Decisions.** One fixed answer per design question (packages, entry points, state, errors, logging, structured output).
- **Templates.** Runnable TypeScript and Python servers, laid out as a functional core plus an imperative shell, with contract tests in both protocol eras.
- **`check_v2`.** A v1-drift linter (Node ≥ 20, no dependencies).
  - It has 47 rules: 35 code patterns, 6 project-level checks and 6 dependency checks. 23 of them are marked *silent*: the code compiles and fails only at runtime or for 2026-07-28 clients.
  - Code rules only look at files that import the MCP SDK.
  - The rules are data in `drift_rules.json`, each with built-in self-tests.
  - Precision is checked against independently written v2 code: an independent 180-file v2 server gives 0 errors.
- **`verify_server`.** Black-box proof that a running server answers 2026-07-28 *and* 2025-era clients. It also checks tool-schema portability and runs the official conformance scenarios that apply to ordinary servers.
- **Evaluation harness.** Ten-question evals over the server's tools, using MCP Python SDK 2.x and the Claude API.
- **`pins.json` and `check_pins`.** Every version in one file, plus a registry check for when they go stale.
- **`evals/`.** The plugin's own eval suite for `claude plugin eval`.

## Results

### Held-out test, Claude Opus 5.5

Five cases written by an independent agent that never saw the skill, 3 runs per arm, with the skill's files in the prompt and without them. Every generated server was installed and run against clients of both protocol eras; the review case was graded against a fixed rubric. Score = expectations met.

| Case | with skill | without |
|---|---|---|
| Remote TypeScript server with bearer auth | 18/18 | 12/18 |
| Python tool with a live confirmation | 9/18 | 7/18 |
| FastMCP 1.x to `mcp` 2.x migration | 18/18 | 9/18 |
| TypeScript stdio server with resources and a prompt | 12/18 | 0/18 |
| Review of a server 2026-07-28 clients cannot reach | 15/15 | 8/15 |
| **Total** | **72/87** | **36/87** |

All 15 points the skill lost come from the test, not the code: a heuristic that read `"purged": false` as a success claim (9), and one reply that printed a file twice (6). With those two grader judgments accepted, the skill scores 87/87 and the baseline 38/87.

Without the skill, all three remote servers served only 2025-era clients, all three stdio servers failed to build, and all three confirmation tools never asked a 2026-07-28 client. `check_v2`'s rules from before the run flagged all 12 failing replies written without the skill.

This ran on skill 0.1.2. Later versions changed no skill instructions or templates: 0.1.3 updated the Inspector pin, and 0.1.4 and 0.1.5 changed packaging and documentation (`CHANGELOG.md`).

### Earlier rounds

- **Claude Haiku 5.5, skill 0.1.0:** 51/87 with the skill, 10/87 without. Every failure with the skill in two cases came from two template bugs, fixed in 0.1.1; a re-run of those cases scored 18/18 and 17/18 with the skill, 0/18 and 0/18 without.
- **Development cases** (`claude plugin eval`, 3 runs per arm, scores 0–1): build a TypeScript server 1.00 vs 0.00, migrate a v1 TypeScript server 1.00 vs 0.00, review legacy-wired code 1.00 vs 0.00, build a Python server 1.00 vs 0.44, unrelated request (must not fire) 1.00 vs 1.00. The skill was revised while these ran.

### Tested surfaces

Claude Code (the evals above) and Cowork: installed from claude.ai, the skill built and verified a TypeScript server end to end, and its checks ran in both the cloud workspace and the desktop app's local workspace.

## Privacy and network use

The plugin collects no personal data and sends nothing to its maintainer. It has no hooks, MCP servers, analytics or telemetry. Its scripts run on your machine, only when you or Claude invoke them:

- `check_v2` reads your project's files and prints its findings locally. It contacts nothing.
- `verify_server` starts or connects to the MCP server you point it at. It runs the MCP Inspector and the MCP conformance tool through `npx` at the exact versions in `pins.json`, so npm downloads them from the npm registry.
- `check_pins --online` asks the npm registry and PyPI for current versions.
- `evaluation.py` sends its prompts and your server's tool results to the Anthropic API, using your own `ANTHROPIC_API_KEY`.
- The skill's scaffold step has Claude run `npm install` or `pip install` in your new project, which fetches the template's dependencies from the npm registry or PyPI.

Nothing is stored beyond the output you ask for. Details: [PRIVACY.md](PRIVACY.md).

## Security and support

Report a vulnerability privately through GitHub's "Report a vulnerability" on [the repository's Security tab](https://github.com/ANcpLua/mcp-builder-v2/security); see [SECURITY.md](SECURITY.md). Questions and bugs: [issues](https://github.com/ANcpLua/mcp-builder-v2/issues).

## Relationship to Anthropic's MCP skills

`mcp-server-dev` (official marketplace) and `mcp-builder` (anthropics/skills) cover deployment choice, MCPB and MCP Apps, but their code targets SDK v1 and spec 2025-11-25 (verified 2026-10-07). This plugin is a bridge for SDK v2 code and its verification. When an official skill ships v2-native scaffolds, this plugin will drop its templates and keep only the drift checker and the both-era verifier.

## License

Apache-2.0. The evaluation guide and harness are adapted from Anthropic's `mcp-builder` skill (Apache-2.0).
