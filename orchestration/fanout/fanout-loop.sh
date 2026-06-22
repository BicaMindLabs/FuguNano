#!/usr/bin/env bash
# fanout-loop.sh — Phase 5 review-fix loop 状态机 (把 SKILL.md 伪代码做成可执行+可测)
#
# 逻辑契约 (loop engineering v2): 有界 review-fix, 三个退出态, 绝不 hard-mark DONE。
#   每轮: 确定性 gate(build/test/lint) → reviewer VERDICT → keep-best → 退出态判定。
#   记录每一轮, 判定下一步, keep-best 自动维护 (findings 变差不更新 best baseline)。
#
# 状态布局 (${FANOUT_CACHE:-<repo>/.fanout-cache}/loop/):
#   meta        key=value: max_rounds / task_file / best_sha / best_n
#   rounds.tsv  每行一轮: round<TAB>gate<TAB>verdict<TAB>findings<TAB>same_class<TAB>sha<TAB>note
#
# 子命令:
#   init  [--max N] [--task F] [--best-sha SHA] [--best-n N]   开 loop, 记 baseline (重置)
#   record <round> --gate pass|fail --verdict ACCEPTED|NEEDSFIX --findings N
#          [--ask-user K] [--sha SHA] [--same-class] [--note "..."]   记一轮 + 自动维护 keep-best
#          (--ask-user K = N 个 findings 里碰意图/需人判断的个数; 其余视作机械可自动修)
#   decide                                                      读历史判退出态 (见下), 打 token+建议
#   next                                                        decide 的别名
#   status                                                      打印 loop 全貌 + best baseline
#   ''                                                          帮助
#
# decide 输出 (stdout 第一行 = decision token):
#   DONE              最近 ACCEPTED 且累计 ≥2 次 ACCEPTED (2 次独立确认) → 收尾 DONE   (exit 0)
#   CONFIRM           最近第一次 ACCEPTED → 再跑 1 次独立确认 pass               (exit 10)
#   CONTINUE          NEEDS FIX 且 findings 全机械 → 操作者 Edit-patch + 下一轮     (exit 10)
#   ASK_USER          NEEDS FIX 且本轮有碰意图 finding → 升级这些给人, 机械的自动修 (exit 11)
#   ESCALATE_MAX      round ≥ max 仍 NEEDS FIX → 停, 升级 (best diff + 余留问题)   (exit 20)
#   ESCALATE_NONCONV  连续两轮同类/findings 未下降 → meta-reflect 再升级           (exit 20)
#
# 退出码: 0=DONE / 10=自动干活(CONTINUE|CONFIRM) / 11=需人判断(ASK_USER) / 20=升级(ESCALATE_*) / 2=用法错
set -uo pipefail

CACHE_ROOT="${FANOUT_CACHE:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.fanout-cache}"
LDIR="$CACHE_ROOT/loop"
META="$LDIR/meta"
ROUNDS="$LDIR/rounds.tsv"

die(){ echo "fanout-loop: $*" >&2; exit 2; }
meta_get(){ sed -n "s/^$1=//p" "$META" 2>/dev/null | head -1; }
meta_set(){ # key value — 原子改写一行
  local k="$1" v="$2" tmp; tmp="$(mktemp)"
  { grep -v "^$k=" "$META" 2>/dev/null; printf '%s=%s\n' "$k" "$v"; } > "$tmp"
  mv -f "$tmp" "$META"
}
need_init(){ [ -f "$META" ] || die "loop 未 init (先 fanout loop init)"; }

cmd_init(){
  local max=3 task="" bsha="" bn=-1
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --max)      max="${2:-}"; shift 2;;
      --task)     task="${2:-}"; shift 2;;
      --best-sha) bsha="${2:-}"; shift 2;;
      --best-n)   bn="${2:-}"; shift 2;;
      *) die "未知参数 '$1'";;
    esac
  done
  [ "$max" -ge 1 ] 2>/dev/null || die "--max 需 ≥1 整数"
  rm -rf "$LDIR"; mkdir -p "$LDIR"
  : > "$ROUNDS"
  { printf 'max_rounds=%s\n' "$max"
    printf 'task_file=%s\n'  "$task"
    printf 'best_sha=%s\n'   "$bsha"
    printf 'best_n=%s\n'     "$bn"; } > "$META"
  echo "✓ loop init: max=$max best_sha=${bsha:-(未设)} best_n=$bn"
}

cmd_record(){
  need_init
  local round="${1:-}"; shift || true
  [ -n "$round" ] && [ "$round" -ge 1 ] 2>/dev/null || die "用法: record <round≥1> --gate .. --verdict .. --findings N"
  local gate="" verdict="" findings="" ask=0 sha="" same=0 note=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --gate)       gate="${2:-}"; shift 2;;
      --verdict)    verdict="${2:-}"; shift 2;;
      --findings)   findings="${2:-}"; shift 2;;
      --ask-user)   ask="${2:-}"; shift 2;;
      --sha)        sha="${2:-}"; shift 2;;
      --same-class) same=1; shift;;
      --note)       note="${2:-}"; shift 2;;
      *) die "未知参数 '$1'";;
    esac
  done
  case "$gate"    in pass|fail) ;; *) die "--gate 须 pass|fail";; esac
  # verdict 归一: ACCEPTED / NEEDSFIX
  case "$(printf '%s' "$verdict" | tr 'a-z ' 'A-Z_')" in
    ACCEPTED|ACCEPT)            verdict=ACCEPTED;;
    NEEDSFIX|NEEDS_FIX|NEEDS)   verdict=NEEDSFIX;;
    *) die "--verdict 须 ACCEPTED|NEEDSFIX";;
  esac
  [ -n "$findings" ] && [ "$findings" -ge 0 ] 2>/dev/null || die "--findings 须 ≥0 整数"
  # --ask-user K = 这 N 个 findings 里需人判断(碰意图)的个数; 其余视作机械可自动修(借鉴 no-mistakes)
  [ "$ask" -ge 0 ] 2>/dev/null || die "--ask-user 须 ≥0 整数"
  [ "$ask" -le "$findings" ] 2>/dev/null || die "--ask-user($ask) 不能 > --findings($findings)"

  # keep-best: best_n<0 = 未设 → 首记为 baseline; findings 更小 → 更新 best; 否则保留旧 best
  local bn bsha kept="kept"; bn="$(meta_get best_n)"; bsha="$(meta_get best_sha)"
  if [ "$bn" -lt 0 ] 2>/dev/null || [ "$findings" -lt "$bn" ] 2>/dev/null; then
    meta_set best_n "$findings"; [ -n "$sha" ] && meta_set best_sha "$sha"; kept="updated"
  fi

  # 列序: round gate verdict findings ask_user same_class sha note
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$round" "$gate" "$verdict" "$findings" "$ask" "$same" "$sha" "$note" >> "$ROUNDS"
  local nbn nbsha; nbn="$(meta_get best_n)"; nbsha="$(meta_get best_sha)"
  echo "✓ round $round: gate=$gate verdict=$verdict findings=$findings ask-user=$ask (best $kept → n=$nbn sha=${nbsha:-—})"
  if [ "$kept" = "kept" ] && [ "$verdict" = NEEDSFIX ] && [ "$findings" -gt "$nbn" ] 2>/dev/null; then
    echo "  ⚠ 本轮比 best 更差 (findings $findings > best $nbn) → 考虑 git reset --hard ${nbsha:-<best_sha>} (keep-best 回退)"
  fi
}

cmd_decide(){
  need_init
  [ -s "$ROUNDS" ] || die "还没 record 任何一轮"
  local max nrounds; max="$(meta_get max_rounds)"; nrounds="$(grep -c . "$ROUNDS")"
  local last_round last_verdict last_find last_ask last_same prev_find prev_same
  IFS=$'\t' read -r last_round _ last_verdict last_find last_ask last_same _ _ < <(tail -1 "$ROUNDS")
  local acc; acc="$(cut -f3 "$ROUNDS" | grep -c '^ACCEPTED$')"
  local bsha bn; bsha="$(meta_get best_sha)"; bn="$(meta_get best_n)"

  emit(){ echo "$1"; printf 'round %s/%s · last verdict=%s findings=%s · best n=%s sha=%s\n' \
            "$last_round" "$max" "$last_verdict" "$last_find" "$bn" "${bsha:-—}"; echo "→ $2"; }

  if [ "$last_verdict" = ACCEPTED ]; then
    if [ "$acc" -ge 2 ]; then
      emit DONE "二次独立确认通过 → 收尾: TASK 标 DONE+Completed, push/交付"; exit 0
    fi
    emit CONFIRM "第一次 ACCEPTED → 再跑 1 次独立确认 review pass (验证是概率性的); 仍 ACCEPTED 才 DONE"; exit 10
  fi

  # last == NEEDSFIX
  if [ "$last_round" -ge "$max" ] 2>/dev/null; then
    emit ESCALATE_MAX "到顶仍 NEEDS FIX → 停手升级: post best 版 diff(sha ${bsha:-—}) + 余留 findings + 你的判断"; exit 20
  fi
  # 非收敛: 显式 same-class, 或连续两轮 findings 都>0 且未下降
  local nonconv=0
  if [ "$last_same" = 1 ]; then nonconv=1
  elif [ "$nrounds" -ge 2 ]; then
    IFS=$'\t' read -r _ _ _ prev_find _ prev_same _ _ < <(tail -2 "$ROUNDS" | head -1)
    [ "$prev_find" -gt 0 ] 2>/dev/null && [ "$last_find" -gt 0 ] 2>/dev/null \
      && [ "$last_find" -ge "$prev_find" ] 2>/dev/null && nonconv=1
  fi
  if [ "$nonconv" -eq 1 ]; then
    emit ESCALATE_NONCONV "连续两轮同类/未下降 → 先 meta-reflect(reviewer 太严? 需求不清? 换实现? fix→break 反复?) 出诊断, 再升级"; exit 20
  fi
  # finding 二分(借 no-mistakes): 本轮有需人判断(碰意图)的 finding → 暂停问人, 别让 Claude 自动 patch
  if [ "${last_ask:-0}" -gt 0 ] 2>/dev/null; then
    emit ASK_USER "本轮 $last_ask/$last_find 个 finding 碰意图(架构/语义/取舍)→ 先把这些升级给人 approve/改/skip; 其余 $((last_find-last_ask)) 个机械的 Claude 直接 Edit-patch, 再跑下一轮"; exit 11
  fi
  emit CONTINUE "本轮 findings 全机械 → 操作者 Edit-patch(不回退给 implementer 重写), commit, 跑下一轮 round $((last_round+1))"; exit 10
}

cmd_status(){
  need_init
  local max task bsha bn; max="$(meta_get max_rounds)"; task="$(meta_get task_file)"
  bsha="$(meta_get best_sha)"; bn="$(meta_get best_n)"
  echo "── fanout loop ── max=$max  best n=$bn sha=${bsha:-—}  task=${task:-—}"
  if [ -s "$ROUNDS" ]; then
    printf '  %-6s %-5s %-9s %-9s %-8s %s\n' round gate verdict findings ask-user note
    local r g v f au s sh n
    while IFS=$'\t' read -r r g v f au s sh n; do
      [ -n "$r" ] || continue
      [ "$s" = 1 ] && n="[same-class] $n"
      printf '  %-6s %-5s %-9s %-9s %-8s %s\n' "$r" "$g" "$v" "$f" "${au:-0}" "$n"
    done < "$ROUNDS"
  else echo "  (还没 record 任何一轮)"; fi
}

sub="${1:-}"; shift || true
case "$sub" in
  init)        cmd_init   "$@";;
  record)      cmd_record "$@";;
  decide|next) cmd_decide "$@";;
  status)      cmd_status "$@";;
  ''|-h|--help) sed -n '2,30p' "$0";;
  *) die "未知子命令 '$sub' (init|record|decide|next|status)";;
esac
