#!/usr/bin/env bash
# Case C setup: clone FuguNano (local, fast), reuse deps, inject the eval fixture.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# Portable repo root: FUGUNANO_SRC wins; else derive from git (this repo), else the cwd.
SRC="${FUGUNANO_SRC:-$(git -C "$HERE" rev-parse --show-toplevel 2>/dev/null || pwd)}"
WORK="${1:-$HERE/work/fugunano}"

echo "==> clone FuguNano (local) -> $WORK"
mkdir -p "$(dirname "$WORK")"
if [ ! -d "$WORK/.git" ]; then
  git clone --local "$SRC" "$WORK"
fi
cd "$WORK"
git checkout -q .
git tag -f caseC-clean HEAD >/dev/null

echo "==> install engine deps"
mkdir -p engine
( cd engine && [ -d node_modules ] || npm install --silent )

echo "==> inject eval fixture (stubs + frozen tests)"
mkdir -p engine/src/adapters/eval
cp "$HERE/fixture/eval.ts" engine/src/domain/eval.ts
cp "$HERE/fixture/eval.test.ts" engine/src/domain/eval.test.ts
cp "$HERE/fixture/eval-runner.ts" engine/src/adapters/eval/eval-runner.ts
cp "$HERE/fixture/eval-runner.test.ts" engine/src/adapters/eval/eval-runner.test.ts
git add -A && git -c user.email=caseC@local -c user.name=caseC commit -q -m "caseC: inject eval fixture (stubs + tests)"
git tag -f caseC-buggy HEAD >/dev/null

echo "==> baseline gate (expect RED — stubs throw)"
( cd engine && npm run check ) 2>&1 | tail -8
echo "==> setup done. clean=caseC-clean  buggy(stubs)=caseC-buggy"
