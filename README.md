# MCP Builder v2

Build, migrate and check MCP servers on **SDK v2** (`@modelcontextprotocol/server` 2.x, Python `mcp` 2.x) and **spec 2026-07-28**.

## Why

Most published MCP code predates SDK v2, so servers written from memory drift to v1 patterns. In TypeScript that drift compiles against the v2 packages, passes the default Inspector and a default-client test, and then fails every client speaking 2026-07-28.

Measured with `claude plugin eval` (3 runs per arm, with and without the plugin; scores 0–1):

| Case | with plugin | without |
|---|---|---|
| Build a TypeScript server | 1.00 | 0.00 |
| Migrate a v1 TypeScript server | 1.00 | 0.00 |
| Review v2-package, legacy-wired code | 1.00 | 0.00 |
| Build a Python server | 1.00 | 0.44 |
| Unrelated request (must not fire) | 1.00 | 1.00 |

These runs had no package-registry access, so they measure the code written, not installed builds. They used the CLI's default model, which was not pinned or recorded at the time. They are development cases: the skill was revised while they were run. See `evals/` to reproduce, ideally on a normal machine.

## Held-out test

Five cases written by an independent agent that never saw the skill. Claude Haiku 5.5, 3 runs per arm, the skill's files pasted into the prompt (no tools). Every generated server was installed and run against clients of both protocol eras; the review was graded against a fixed rubric. Score = expectations met.

| Case | with skill | without |
|---|---|---|
| Remote TypeScript server with bearer auth | 18/18 | 4/18 |
| Python tool with a live confirmation | 6/18 | 0/18 |
| FastMCP 1.x to `mcp` 2.x migration | 12/18 | 0/18 |
| TypeScript stdio server with resources and a prompt | 0/18 | 0/18 |
| Review of a server 2026-07-28 clients cannot reach | 15/15 | 6/15 |
| **Total** | **51/87** | **10/87** |

Every failure with the skill in the second and fourth case came from two template bugs, fixed in 0.1.1 (`CHANGELOG.md`). A re-run of those two cases with 0.1.1 scored 18/18 and 17/18 with the skill, 0/18 and 0/18 without; they now count as development cases. `check_v2`'s rules from before the run flagged all 12 failing replies written without the skill.

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

## Use

Ask Claude to build an MCP server, migrate one off SDK v1, or check one for v1 drift. The skill can also be invoked directly as `/mcp-builder-v2:mcp-builder-v2`.

Requirements:

- Node ≥ 20. `verify_server` needs ≥ 22.19 for Inspector 2.x.
- Python ≥ 3.10, for Python servers and the evaluation harness.

## Relationship to Anthropic's MCP skills

`mcp-server-dev` (official marketplace) and `mcp-builder` (anthropics/skills) cover deployment choice, MCPB and MCP Apps, but their code targets SDK v1 and spec 2025-11-25 (verified 2026-10-07). This plugin is a bridge for SDK v2 code and its verification.

**When an official skill ships v2-native scaffolds,** this plugin will drop its templates and keep only the drift checker and the both-era verifier.

## Maintenance

- **Every push** (GitHub Actions, no model usage): drift-rule self-tests, both templates in both eras, `verify_server`, and registry news.
- **Weekly** (`.github/workflows/evals.yml`, on API credits, pinned to Opus 5.5): `node ci/weekly.mjs` runs the same checks plus `claude plugin eval`, capped at $20 per run. The same script also runs as a scheduled task on a Claude plan, where it adds a precision canary (`check_v2` on an independently written v2 server): `ci/SCHEDULED_TASK.md`.
- **On any SDK or spec release, or at least every 90 days:** follow `skills/mcp-builder-v2/reference/maintenance.md`. `pins.json` records `verified_on`.

## License

Apache-2.0. The evaluation guide and harness are adapted from Anthropic's `mcp-builder` skill (Apache-2.0).
