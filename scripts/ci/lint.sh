#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

mapfile -t js_files < <(find src api tests -type f -name '*.js' -print | sort)
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

echo "Lint passed for ${#js_files[@]} JavaScript files and ${#sh_files[@]} shell scripts."
