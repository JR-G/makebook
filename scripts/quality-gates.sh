#!/usr/bin/env bash
set -euo pipefail

REPOSITORY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPOSITORY_ROOT"

fail() {
  echo "quality-gate failed: $1" >&2
  exit 1
}

if grep -rEn \
  --include='*.ts' \
  --include='*.tsx' \
  --exclude-dir='node_modules' \
  --exclude-dir='dist' \
  --exclude-dir='coverage' \
  -- "from ['\"](\\.\\./)+(apps|packages)/" . >/tmp/makebook-quality-imports.txt 2>/dev/null; then
  echo "disallowed deep relative cross-package imports found:" >&2
  cat /tmp/makebook-quality-imports.txt >&2
  fail "use workspace package imports instead of deep relative imports"
fi

if rg -n --glob '**/*.ts' --glob '**/*.tsx' --glob '!node_modules/**' --glob '!dist/**' --glob '!coverage/**' "-----BEGIN [A-Z ]*PRIVATE KEY-----" . >/tmp/makebook-quality-secrets.txt 2>/dev/null; then
  echo "private-key-like fixture text found:" >&2
  cat /tmp/makebook-quality-secrets.txt >&2
  fail "replace secret-like fixtures with placeholders"
fi

if rg -n --glob '**/*.ts' --glob '**/*.tsx' --glob '!node_modules/**' --glob '!dist/**' --glob '!coverage/**' --glob '!**/*.test.ts' --glob '!**/*.test.tsx' 'SELECT .+ FROM' apps packages 2>/dev/null | grep -iv 'LIMIT\|CREATE\|INSERT\|SCHEMA\|PRIMARY KEY' >/tmp/makebook-quality-unbounded-sql.txt; then
  if [ -s /tmp/makebook-quality-unbounded-sql.txt ]; then
    echo "SQL query without LIMIT found:" >&2
    cat /tmp/makebook-quality-unbounded-sql.txt >&2
    fail "add LIMIT to SELECT queries that return variable-length results"
  fi
fi

echo "quality-gates passed"
