#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

mapfile -t js_files < <(find src api tests scripts -type f \( -name '*.js' -o -name '*.mjs' \) -print | sort)
if [[ "${#js_files[@]}" -eq 0 ]]; then
  echo 'No JavaScript files found to lint.' >&2
  exit 1
fi

for file in "${js_files[@]}"; do
  node --check "$file"
done

mapfile -t sh_files < <(find scripts -type f -name '*.sh' -print | sort)
for file in "${sh_files[@]}"; do
  bash -n "$file"
done

if grep -RInE '[[:blank:]]+$' src api tests scripts package.json vercel.json; then
  echo 'Trailing whitespace is forbidden.' >&2
  exit 1
fi

if grep -RInE '\beval[[:space:]]*\(|new[[:space:]]+Function[[:space:]]*\(' src api; then
  echo 'Dynamic code execution is forbidden in application code.' >&2
  exit 1
fi

node --test tests/architecture/*.test.js

echo "Lint/static analysis passed for ${#js_files[@]} JavaScript files and ${#sh_files[@]} shell scripts."
