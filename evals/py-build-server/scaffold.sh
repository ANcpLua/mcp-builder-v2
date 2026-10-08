#!/usr/bin/env bash
# Seeds the workspace with the dataset the prompt refers to.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p data
cp "$here/library.json" data/library.json
