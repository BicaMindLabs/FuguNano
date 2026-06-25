#!/usr/bin/env bash
# fuguectl-dispatch.sh — fetch/render prompt → dispatch to agent (harness-agnostic) → log TASK
#   fuguectl-dispatch.sh <target> [--harness fugue-cc|codex|opencode] [--workspace <ws>] \
#       (--template <name> [--set K=V ...] | --prompt-file <f>) [--task <file>]
#   --harness pick executor: fugue-cc(default, Claude Code cc-* clone via fugue-cc provider) / codex / opencode
#     <target> meaning varies by harness: fugue-cc=cc agent(cc-deepseek) / codex=model(gpt-5.5) / opencode=provider/model
#   --workspace prefix-inject that workspace's layered context (Zleap-style: feed only what it should see)
#   --task-type T  append (T, agent) into alloc ledger → later `allocate feed --from-ledger` feeds verdict back to routing(data flywheel)
#   --skills a,b   inject selected skill into that agent context (progressive disclosure; via fuguectl-skills inject)
#   env: FUGUE_CC_BIN / FUGUE_CODEX / FUGUE_OPENCODE (tests may stub)
#        FUGUE_ALLOCATION_LEDGER (alloc ledger path, consistent with allocate)
set -uo pipefail
# shellcheck source=/dev/null
. "$(dirname "${BASH_SOURCE[0]}")/fuguectl-lib.sh"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FUGUE_CC="${FUGUE_CC_BIN:-fugue-cc}"
LEDGER="${FUGUE_ALLOCATION_LEDGER:-${FUGUE_STATE:-$HOME/.config/fugue}/alloc-ledger.tsv}"

agent="${1:-}"; shift || true
[ -n "$agent" ] || die "usage: <agent> (--template <name> [--set K=V] | --prompt-file <f>) [--task <file>]"

tpl=""; pfile=""; task=""; ws=""; harness="${FUGUE_DEFAULT_HARNESS:-fugue-cc}"; ttype=""; skills=""; sets=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --template)    tpl="${2:-}"; shift 2;;
    --set)         sets+=("--set" "${2:-}"); shift 2;;
    --prompt-file) pfile="${2:-}"; shift 2;;
    --workspace)   ws="${2:-}"; shift 2;;
    --harness)     harness="${2:-}"; shift 2;;
    --task)        task="${2:-}"; shift 2;;
    --task-type)   ttype="${2:-}"; shift 2;;
    --skills)      skills="${2:-}"; shift 2;;
    *) die "unknown arg '$1'";;
  esac
done

# skills inject prefix (progressive disclosure: feed this agent only the skill it should crawl)
skills_ctx=""
[ -n "$skills" ] && skills_ctx="$(bash "$HERE/fuguectl-skills.sh" inject "$skills")
"
# workspace context prefix (Zleap-inspired: feed only this workspace's layered context to see)
ctx=""
[ -n "$ws" ] && ctx="$(bash "$HERE/fuguectl-workspace.sh" context "$ws")
"

# fetch prompt body
if [ -n "$pfile" ]; then
  [ -f "$pfile" ] || die "no prompt file $pfile"; body="$(cat "$pfile")"
elif [ -n "$tpl" ]; then
  body="$(bash "$HERE/fuguectl-template.sh" "$tpl" ${sets[@]+"${sets[@]}"})"
elif [ -n "$ws" ]; then
  body=""   # workspace context alone serves as prompt
else die "need --template <name> / --prompt-file <f> / --workspace <name>"; fi
prompt="${skills_ctx}${ctx}${body}"

# dispatch (harness-agnostic): <target> meaning varies by harness
case "$harness" in
  fugue-cc) printf '%s\n' "$prompt" | "$FUGUE_CC" ask "$agent" --compact; rc=$? ;; # Claude Code cc-* clone via fugue-cc provider
  codex)        "${FUGUE_CODEX:-codex}" exec --model "$agent" "$prompt"; rc=$? ;; # codex exec, target=model
  opencode)     "${FUGUE_OPENCODE:-opencode}" run -m "$agent" "$prompt"; rc=$? ;; # opencode run, target=provider/model
  *) die "unknown harness '$harness' (fugue-cc|codex|opencode)" ;;
esac

# log TASK (optional)
if [ -n "$task" ] && [ -f "$task" ]; then
  printf -- '- [%s] dispatch → %s [%s] (rc=%s)\n' "$(TZ=Asia/Shanghai date '+%Y-%m-%d %H:%M')" "$agent" "$harness" "$rc" >> "$task"
fi
# alloc ledger (optional): record (task-type, agent) for `allocate feed --from-ledger` to feed verdict back to routing
if [ -n "$ttype" ]; then
  mkdir -p "$(dirname "$LEDGER")"
  printf '%s\t%s\n' "$ttype" "$agent" >> "$LEDGER"
fi
exit "$rc"
