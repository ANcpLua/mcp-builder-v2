#!/usr/bin/env bash
# Seeds the workspace with a v1 MCP server project under git, so the agent can diff its changes.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp -R "$here/fixture/." .
git init -q && git add -A && git -c user.email=eval@example.com -c user.name=eval commit -qm "v1 server"
