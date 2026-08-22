#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

node --test tests/unit/*.test.js
node --test tests/architecture/*.test.js
node --test tests/integration/*.test.js
