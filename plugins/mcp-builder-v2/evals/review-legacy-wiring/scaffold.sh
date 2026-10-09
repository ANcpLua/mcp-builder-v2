#!/usr/bin/env bash
# Seeds the workspace with a server already moved to SDK v2 packages but still wired the legacy way.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp -R "$here/fixture/." .
