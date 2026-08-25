#!/usr/bin/env bash
set -euo pipefail

is_documentation_only_path() {
  local file="$1"
  case "$file" in
    docs/*|README.md|LICENSE|CHANGELOG.md|CONTRIBUTING.md|CODE_OF_CONDUCT.md|SECURITY.md|*.md)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

base_sha="${1:-}"
head_sha="${2:-}"

if [[ ! "$base_sha" =~ ^[0-9a-f]{40}$ ]] || [[ ! "$head_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "::error::classify-release-impact.sh requires canonical base and head commit SHAs" >&2
  exit 2
fi

git cat-file -e "${base_sha}^{commit}" 2>/dev/null || {
  echo "::error::Release impact base commit is unavailable: ${base_sha}" >&2
  exit 3
}
git cat-file -e "${head_sha}^{commit}" 2>/dev/null || {
  echo "::error::Release impact head commit is unavailable: ${head_sha}" >&2
  exit 3
}

mapfile -t changed_files < <(git diff --name-only --diff-filter=ACMRTUXB "$base_sha" "$head_sha")

requires_release=false
runtime_files=0
documentation_files=0

for file in "${changed_files[@]}"; do
  if is_documentation_only_path "$file"; then
    documentation_files=$((documentation_files + 1))
  else
    requires_release=true
    runtime_files=$((runtime_files + 1))
  fi
done

classification="documentation-only"
if [[ "$requires_release" == true ]]; then
  classification="runtime-impacting"
fi

printf 'requires_release=%s\n' "$requires_release"
printf 'classification=%s\n' "$classification"
printf 'changed_file_count=%s\n' "${#changed_files[@]}"
printf 'runtime_file_count=%s\n' "$runtime_files"
printf 'documentation_file_count=%s\n' "$documentation_files"
