#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

readonly ESLINT_VERSION='10.9.0'
readonly ACTIONLINT_VERSION='1.7.12'
readonly ACTIONLINT_LINUX_AMD64_SHA256='8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8'

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

if grep -RInE '[[:blank:]]+$' src api tests scripts .github/workflows package.json vercel.json eslint.config.js; then
  echo 'Trailing whitespace is forbidden.' >&2
  exit 1
fi

# Exact-version invocation keeps the JavaScript static-analysis engine explicit
# and auditable without making the deploy artifact depend on development tooling.
npx --yes "eslint@${ESLINT_VERSION}" \
  src api tests scripts eslint.config.js \
  --max-warnings=0

# Workflows are production code. Validate GitHub Actions syntax, contexts and
# expressions with a pinned actionlint binary whose release checksum is fixed.
if [[ "$(uname -s)" != 'Linux' || "$(uname -m)" != 'x86_64' ]]; then
  echo 'actionlint bootstrap currently supports the GitHub-hosted Linux amd64 CI runner only.' >&2
  exit 1
fi

actionlint_tmp="$(mktemp -d)"
trap 'rm -rf "$actionlint_tmp"' EXIT
actionlint_archive="$actionlint_tmp/actionlint.tar.gz"
curl --fail --silent --show-error --location \
  "https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/actionlint_${ACTIONLINT_VERSION}_linux_amd64.tar.gz" \
  --output "$actionlint_archive"
printf '%s  %s\n' "$ACTIONLINT_LINUX_AMD64_SHA256" "$actionlint_archive" | sha256sum --check --status || {
  echo 'actionlint archive checksum mismatch.' >&2
  exit 1
}
tar -xzf "$actionlint_archive" -C "$actionlint_tmp" actionlint
"$actionlint_tmp/actionlint" -color

# Architecture tests exercise the immutable Vercel bundle, which intentionally
# contains the locked PostgreSQL runtime dependencies. Install from the lockfile
# when lint is executed in an otherwise clean checkout.
if [[ ! -d node_modules ]]; then
  npm ci --ignore-scripts --no-audit --no-fund
fi
node --test tests/architecture/*.test.js

echo "Lint/static analysis passed with ESLint ${ESLINT_VERSION} and actionlint ${ACTIONLINT_VERSION} for ${#js_files[@]} JavaScript files, ${#sh_files[@]} shell scripts and GitHub Actions workflows."
