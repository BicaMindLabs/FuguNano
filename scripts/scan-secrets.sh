#!/usr/bin/env bash
# scan-secrets.sh — repo secret-leak gate (shared by local / CI / pre-commit)
# Any suspected plaintext key match -> exit 1. allowlist: <PLACEHOLDER> in *.example + valid attributions.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 2
fail=0

# Scan scope: git-tracked plus untracked-but-not-ignored files (fall back to find),
# excluding .git / node_modules.
if git rev-parse --git-dir >/dev/null 2>&1; then
  mapfile -t FILES < <(git ls-files --cached --others --exclude-standard)
else
  mapfile -t FILES < <(find . -type f -not -path './.git/*' -not -path '*/node_modules/*' | sed 's|^\./||')
fi

# ── 1) plaintext key fingerprints ───────────────────────────
# sk-... (deepseek/kimi/minimax/openai) | tp-... (mimo) | zhipu hex32.b64-16
SECRET_RE='sk-[A-Za-z0-9_-]{20,}|tp-[a-z0-9]{30,}|[0-9a-f]{32}\.[A-Za-z0-9]{16}'
for f in "${FILES[@]}"; do
  [ -f "$f" ] || continue
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    echo "  ✗ suspected key  $f: $line" ; fail=1
  done < <(grep -nE "$SECRET_RE" "$f" 2>/dev/null)
done

# ── 2) key= in provider.config(.example) must be <PLACEHOLDER> ─────
for f in "${FILES[@]}"; do
  case "$f" in *provider.config*) ;; *) continue ;; esac
  while IFS= read -r line; do
    content="${line#*:}"                             # strip grep -n's "lineno:" prefix
    # take the quoted value to the right of =, must look like <XXX>
    val="$(printf '%s' "$content" | sed -E 's/^[[:space:]]*key[[:space:]]*=[[:space:]]*"?([^"]*)"?.*/\1/')"
    case "$val" in
      '<'*'>') : ;;                                  # ok: placeholder
      '') : ;;                                        # empty is allowed too
      *) echo "  ✗ key not a placeholder  $f: $line"; fail=1 ;;
    esac
  done < <(grep -nE '^[[:space:]]*key[[:space:]]*=' "$f" 2>/dev/null)
done

if [ "$fail" -eq 0 ]; then
  echo "✓ scan-secrets: 0 hits (${#FILES[@]} files)"
else
  echo "✗ scan-secrets: suspected key found, blocking."
fi
exit "$fail"
