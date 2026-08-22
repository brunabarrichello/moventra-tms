#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

readonly ESLINT_VERSION='10.9.0'

mapfile -t js_files < <(find src api tests scripts -type f \( -name '*.js' -o -name '*.mjs' \) -print | sort)
if [[ "${#js_files[@]}" -eq 0 ]]; then
  echo 'No JavaScript files found to lint.' >&2
  exit 1
fi

for file in "${js_files[@]}"; do
  node --check "$file"
done
node --check eslint.config.js

mapfile -t sh_files < <(find scripts -type f -name '*.sh' -print | sort)
for file in "${sh_files[@]}"; do
  bash -n "$file"
done

if grep -RInE '[[:blank:]]+$' src api tests scripts package.json vercel.json eslint.config.js; then
  echo 'Trailing whitespace is forbidden.' >&2
  exit 1
fi

# Exact-version invocation keeps the static-analysis engine explicit and auditable
# without making the deploy artifact depend on development tooling.
npx --yes "eslint@${ESLINT_VERSION}" \
  src api tests scripts eslint.config.js \
  --max-warnings=0

node --test tests/architecture/*.test.js

echo "Lint/static analysis passed with ESLint ${ESLINT_VERSION} for ${#js_files[@]} JavaScript files and ${#sh_files[@]} shell scripts."
