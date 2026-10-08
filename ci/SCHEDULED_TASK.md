# Weekly check as a scheduled task

The weekly check runs on your Claude plan as a scheduled task, not in GitHub Actions, so it needs no API key. Every
model call in it is pinned to Claude Haiku 5.5.

## Settings in "Create scheduled task"

| Field | Value |
|---|---|
| Repository / environment | `ANcpLua/qyl.mcp` with its environment (network access: Full) |
| Setup script | keep `npm install`; optionally add `apt-get update && apt-get install -y bubblewrap socat` (the eval sandbox needs them; the script installs them itself when they are missing) |
| Model | Haiku 5.5 |
| Frequency | Weekly |
| Permissions | Auto (nobody is there to approve commands) |
| Notifications | On |

Optional environment variables, so each run shows up in qyl (`ci_log` lists it as service `qyl-ci-mcp-builder-v2`,
one span per phase; eval scores arrive as the gauge `mcp_builder_v2.eval.score`):

- `QYL_OTLP_ENDPOINT`: the collector's OTLP/HTTP base URL, reachable from the cloud environment
- `QYL_OTLP_HEADERS`: the key header the collector expects, as `name=value`

## Prompt

```text
Weekly regression check for the mcp-builder-v2 plugin. Do not edit, commit or push anything, and do not open issues or pull requests.

1. Clone the plugin: git clone --depth 1 https://github.com/ANcpLua/mcp-builder-v2 /tmp/mcp-builder-v2
   If the clone is refused, attach ANcpLua/mcp-builder-v2 with the add_repo tool (read access) and clone again.
2. From this session's qyl.mcp checkout, start the check in the background:
   nohup node /tmp/mcp-builder-v2/ci/weekly.mjs --canary "$(git rev-parse --show-toplevel)" --out /tmp/weekly > /tmp/weekly.log 2>&1 &
3. Then repeat this command until its output contains a line starting with DONE, for at most 90 minutes:
   sleep 290; tail -3 /tmp/weekly.log
4. Reply with the full contents of /tmp/weekly/summary.md, verbatim and nothing else.
   If no DONE line appeared, reply with the last 40 lines of /tmp/weekly.log instead.
```

If the plugin repository gets another name, change it in steps 1 and 2.

## What a run does

| Phase | Model usage | Fails the run (RED) |
|---|---|---|
| Drift-rule self-test, pins, both templates in both eras, `verify_server` on both templates | none | yes |
| Canary: `check_v2` on qyl.mcp, an independently written v2 server. An error-level finding is either a checker false positive or real drift in qyl.mcp; the summary shows which file and rule | none | yes |
| Release news: newer SDK or tool versions than `pins.json` | none | no (AMBER) |
| `claude plugin eval`, with-plugin arm, 1 run per case, cost ceiling $3 | 5 Haiku runs + Haiku graders | no (AMBER on a score change > 0.25, or if it did not complete) |
| First 7 days of a month instead: both arms, 3 runs per case, ceiling $10 | 30 Haiku runs + graders | same |

Costs are the CLI's own reported figures; on a Claude plan they count against your usage limits.

## Baseline

The first run has nothing to compare with. When its numbers look right, adopt them:

```bash
node ci/weekly.mjs --write-baseline <out>/eval.json --model claude-haiku-5-5
git add ci/baseline && git commit -m "Adopt Haiku eval baseline"
```

Later runs flag a case whose with-plugin score moved more than 0.25 from the baseline. One run per case can move by
chance, so confirm a DROP with a full run before acting on it:
`node ci/weekly.mjs --full --canary <qyl.mcp checkout>`.

Haiku scores are not comparable with the numbers in the README, which were measured with the CLI's default model
(not pinned at the time).
