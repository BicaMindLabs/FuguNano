#!/usr/bin/env bash
# fanout-allocate.sh — 任务类型 → 推荐模型 (bench 先验 + 实战经验 贝叶斯混合)
#
# 静态 bench 表(allocation.tsv)当 Beta 先验; 实战 record 的成功/失败做后验更新。
# **冷启动(无 record)= 完全等于 bench 顺序**; 跑多了才按实战胜率漂移 ([[model_task_allocation_bench]])。
# Beta-Bernoulli: 每 agent 先验 p0 由 bench 排名给(首选高、靠后低、未列入低基线 0.15),
# 伪计数 KAPPA 控制"多少真实样本才盖过 bench"(默认 4 → 跑几把才开始偏离)。Laplace 平滑(+1/+1)
# 保证没 agent 被一次失败永久饿死(探索下限)。借鉴 TRINITY 的学习式协调,但无需训练。
#
#   <task-type> [--top] [--sample]         ranked 模型 (--top 只首选; --sample=Thompson Sampling 探索)
#   list                                   打印静态 bench 全表 (不含实战)
#   record <task-type> <agent> <ok|fail>   记一次实战结果 (胜/负) → 喂后验
#   feed   type:agent:result [...]         批量记 (一把喂多条) — 数据飞轮的便捷喂口
#   feed   --from-ledger --result ok|fail [--fail a,b] [--ok a,b] [--keep]
#          从 dispatch --task-type 写的 round ledger 读 (type,agent), 整轮默认 result,
#          个别 agent 用 --fail/--ok 覆盖; 记完清 ledger (--keep 保留)。把 verdict 自动喂回路由。
#   stats  <task-type>                     看该类型每 agent 的 score / 样本(s/f) / 先验
#   reset  [<task-type>]                   清实战统计 (全部 或 单类型)
#   decay  [--gamma G] [--type T]          折扣遗忘: s,f ×G(<1, 默认0.5); 模型升级后用 (非平稳 bandit)
#   env: FANOUT_ALLOCATION(bench 表) FANOUT_ALLOCATION_STATS(统计文件) FANOUT_ALLOCATION_LEDGER(ledger)
#        FANOUT_ALLOCATE_KAPPA(先验强度, 默认4) FANOUT_ALLOCATE_SEED(TS 采样种子, 测试用) FANOUT_STATE
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TBL="${FANOUT_ALLOCATION:-$HERE/allocation.tsv}"
STATS="${FANOUT_ALLOCATION_STATS:-${FANOUT_STATE:-$HOME/.config/fanout}/allocation-stats.tsv}"
LEDGER="${FANOUT_ALLOCATION_LEDGER:-${FANOUT_STATE:-$HOME/.config/fanout}/alloc-ledger.tsv}"
KAPPA="${FANOUT_ALLOCATE_KAPPA:-4}"
UNLISTED_PRIOR=0.15
die(){ echo "fanout-allocate: $*" >&2; exit 2; }
[ -f "$TBL" ] || die "无 allocation 表 $TBL"

bench_list(){ grep -vE '^[[:space:]]*#' "$TBL" | awk -F'\t' -v k="$1" '$1==k{print $2; f=1} END{exit !f}'; }

# 打分核心: 给定 task + bench 串, 读 STATS, 算每 agent 的 Beta(A,B) 评分, 输出 "score<TAB>rank<TAB>agent"。
# sample=0 → 后验均值 A/(A+B) (贪心, 默认, 冷启动确定性); sample=1 → Thompson Sampling:
#   从 Beta(A,B) 采样后排序 (高斯近似), 样本少→方差大→有概率被探索, 不会过早锁死早期赢家。
#   理论: Agrawal & Goyal 2012 (Beta-Bernoulli TS 近最优 regret); Russo et al. 2018 tutorial。
_score_rows(){
  local task="$1" models="$2" sample="${3:-0}" statsfile="$STATS"
  [ -f "$statsfile" ] || statsfile=/dev/null   # 查询不产生副作用
  awk -F'\t' -v task="$task" -v blist="$models" -v kappa="$KAPPA" -v up="$UNLISTED_PRIOR" \
      -v sample="$sample" -v seed="${FANOUT_ALLOCATE_SEED:-}" '
    function bsample(A,B,   mean,var,sd,z,v){   # Beta(A,B) 的高斯近似 Thompson 采样
      mean=A/(A+B); var=A*B/((A+B)*(A+B)*(A+B+1)); sd=sqrt(var)
      z=sqrt(-2*log(rand()+1e-12))*cos(6.2831853*rand())   # Box-Muller 标准正态
      v=mean+z*sd; if(v<0)v=0; if(v>1)v=1; return v
    }
    BEGIN{
      if(seed!="") srand(seed); else srand()
      m=split(blist, arr, ",")
      for(i=1;i<=m;i++){ ag=arr[i]; gsub(/^[ \t]+|[ \t]+$/,"",ag)
        listed[ag]=1; prior[ag]=(m-(i-1))/(m+1); order[ag]=i }
    }
    $1==task { s[$2]=$3+0; f[$2]=$4+0; seen[$2]=1 }
    END{
      for(ag in listed) cand[ag]=1
      for(ag in seen)   cand[ag]=1
      for(ag in cand){
        p0 = (ag in listed) ? prior[ag] : up
        a0 = kappa*p0 + 1; b0 = kappa*(1-p0) + 1
        ss = (ag in s) ? s[ag] : 0; ff = (ag in f) ? f[ag] : 0
        A = a0+ss; B = b0+ff
        score = (sample=="1") ? bsample(A,B) : A/(A+B)
        ord = (ag in order) ? order[ag] : 9999
        printf "%.6f\t%d\t%s\n", score, ord, ag
      }
    }' "$statsfile" | sort -t"$(printf '\t')" -k1,1nr -k2,2n -k3,3
}

cmd_rank(){
  local task="$1" top="$2" sample="${3:-0}" models
  if models="$(bench_list "$task")"; then :; else
    models="$(bench_list fallback)" || die "表里连 fallback 都没有"
    echo "fanout-allocate: 未知任务类型 '$task' → 回退 fallback ($models)" >&2
    task="fallback"
  fi
  local ranked; ranked="$(_score_rows "$task" "$models" "$sample" | cut -f3)"
  if [ "$top" -eq 1 ]; then printf '%s\n' "$ranked" | head -1
  else printf '%s\n' "$ranked" | grep -v '^$' | tr '\n' ',' | sed 's/,$//'; echo; fi
}

cmd_stats(){
  local task="${1:-}"; [ -n "$task" ] || die "用法: stats <task-type>"
  local models; models="$(bench_list "$task")" || { models="$(bench_list fallback)"; task="fallback"; }
  echo "── allocate stats: $task (kappa=$KAPPA) ──"
  printf '  %-12s %-8s %-6s %s\n' agent score "s/f" prior
  local statsfile="$STATS"; [ -f "$statsfile" ] || statsfile=/dev/null
  # 复算一遍带 s/f/prior 明细
  local models_q="$models"
  awk -F'\t' -v task="$task" -v blist="$models_q" -v kappa="$KAPPA" -v up="$UNLISTED_PRIOR" '
    BEGIN{ m=split(blist,arr,",")
      for(i=1;i<=m;i++){ ag=arr[i]; gsub(/^[ \t]+|[ \t]+$/,"",ag); listed[ag]=1; prior[ag]=(m-(i-1))/(m+1); order[ag]=i } }
    $1==task { s[$2]=$3+0; f[$2]=$4+0; seen[$2]=1 }
    END{
      for(ag in listed) cand[ag]=1; for(ag in seen) cand[ag]=1
      for(ag in cand){
        p0=(ag in listed)?prior[ag]:up; a0=kappa*p0+1; b0=kappa*(1-p0)+1
        ss=(ag in s)?s[ag]:0; ff=(ag in f)?f[ag]:0; score=(a0+ss)/(a0+b0+ss+ff)
        ord=(ag in order)?order[ag]:9999
        printf "%.6f\t%d\t%s\t%g\t%g\t%.2f\n", score, ord, ag, ss, ff, p0
      }
    }' "$statsfile" | sort -t"$(printf '\t')" -k1,1nr -k2,2n -k3,3 \
    | while IFS="$(printf '\t')" read -r score ord ag ss ff p0; do
        printf '  %-12s %-8.3f %-6s %s\n' "$ag" "$score" "$ss/$ff" "$p0"
      done
}

cmd_record(){
  local task="${1:-}" agent="${2:-}" res="${3:-}"
  [ -n "$task" ] && [ -n "$agent" ] && [ -n "$res" ] || die "用法: record <task-type> <agent> <ok|fail>"
  # 归一: ccb agent 名 cc-doubao → bench 表的裸名 doubao, 否则经验喂进不同 key、飞轮不闭合
  agent="${agent#cc-}"
  case "$(printf '%s' "$res" | tr 'A-Z' 'a-z')" in
    ok|success|pass|1|win)        res=ok;;
    fail|failure|0|loss|needsfix) res=fail;;
    *) die "<result> 须 ok|fail (收到 '$res')";;
  esac
  # 自审 finding: 不在 bench 表的 task-type 记录会成孤儿 (allocate 查询时回退 fallback 桶, 读不到本类型统计)
  bench_list "$task" >/dev/null 2>&1 || \
    echo "fanout-allocate: ⚠ '$task' 不在 bench 表(allocation.tsv) — allocate 查询会回退 fallback, 这些 record 读不到; 要生效请把 '$task' 加进表" >&2
  mkdir -p "$(dirname "$STATS")"; [ -f "$STATS" ] || : > "$STATS"
  local tmp; tmp="$(mktemp)"
  awk -F'\t' -v OFS='\t' -v t="$task" -v a="$agent" -v r="$res" '
    $1==t && $2==a { if(r=="ok") $3=$3+1; else $4=$4+1; print; done=1; next }
    { print }
    END{ if(!done){ if(r=="ok") print t,a,1,0; else print t,a,0,1 } }' "$STATS" > "$tmp"
  mv -f "$tmp" "$STATS"
  local line; line="$(awk -F'\t' -v t="$task" -v a="$agent" '$1==t&&$2==a{print "s="$3" f="$4}' "$STATS")"
  echo "✓ record $task/$agent $res → $line"
}

cmd_reset(){
  local task="${1:-}"
  [ -f "$STATS" ] || { echo "(无统计可清)"; return 0; }
  if [ -z "$task" ]; then rm -f "$STATS"; echo "✓ 已清空全部实战统计"; return 0; fi
  local tmp; tmp="$(mktemp)"
  awk -F'\t' -v t="$task" '$1!=t' "$STATS" > "$tmp"; mv -f "$tmp" "$STATS"
  echo "✓ 已清 '$task' 的实战统计"
}

# decay: 折扣遗忘 — s,f ×gamma(<1), 让后验淡忘陈旧统计。模型升级后用 (非平稳 bandit)。
# 理论: Garivier & Moulines 2011 (switching bandits); Raj & Kalyani 2017 (discounted TS)。
cmd_decay(){
  local gamma=0.5 task=""
  while [ "$#" -gt 0 ]; do case "$1" in
    --gamma) gamma="${2:-}"; shift 2;; --type) task="${2:-}"; shift 2;; *) die "未知参数 '$1'";; esac
  done
  awk -v g="$gamma" 'BEGIN{exit !(g>0 && g<1)}' || die "--gamma 须 (0,1) 之间, 收到 '$gamma'"
  [ -f "$STATS" ] || { echo "(无统计可衰减)"; return 0; }
  local tmp; tmp="$(mktemp)"
  awk -F'\t' -v OFS='\t' -v g="$gamma" -v t="$task" '
    { if(t=="" || $1==t){ $3=$3*g; $4=$4*g } print }' "$STATS" > "$tmp"
  mv -f "$tmp" "$STATS"
  echo "✓ decay: ${task:-全部} 的 s/f ×$gamma (折扣遗忘陈旧统计; 模型升级后跑)"
}

_in_list(){ local x="$1"; shift; local e; for e in "$@"; do [ "$e" = "$x" ] && return 0; done; return 1; }

# feed: 批量喂后验 (数据飞轮). 两模式: 显式 tuples 或 --from-ledger
cmd_feed(){
  local from_ledger=0 result="" ledger="$LEDGER" keep=0
  local fails=() oks=() tuples=()
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --from-ledger) from_ledger=1; shift;;
      --result) result="${2:-}"; shift 2;;
      --fail) IFS=',' read -r -a fails <<< "${2:-}"; shift 2;;
      --ok)   IFS=',' read -r -a oks  <<< "${2:-}"; shift 2;;
      --ledger) ledger="${2:-}"; shift 2;;
      --keep) keep=1; shift;;
      -*) die "未知参数 '$1'";;
      *) tuples+=("$1"); shift;;
    esac
  done
  local n=0 t a r
  if [ "$from_ledger" -eq 1 ]; then
    [ -f "$ledger" ] || die "无 ledger: $ledger (dispatch --task-type 会写它)"
    case "$result" in ok|fail) ;; *) die "--from-ledger 需 --result ok|fail (整轮默认; 个别用 --fail/--ok 覆盖)";; esac
    while IFS=$'\t' read -r t a; do
      [ -n "$t" ] && [ -n "$a" ] || continue
      r="$result"
      _in_list "$a" ${fails[@]+"${fails[@]}"} && r=fail
      _in_list "$a" ${oks[@]+"${oks[@]}"}     && r=ok
      cmd_record "$t" "$a" "$r" >/dev/null && n=$((n+1))
    done < "$ledger"
    [ "$keep" -eq 1 ] || : > "$ledger"
    echo "✓ feed: 从 ledger 记 $n 条 (默认=$result fail=[${fails[*]:-}] ok=[${oks[*]:-}]); ledger $([ "$keep" -eq 1 ] && echo 保留 || echo 已清)"
  else
    [ "${#tuples[@]}" -ge 1 ] || die "用法: feed type:agent:result [...] | feed --from-ledger --result ok|fail [--fail a,b]"
    local tup
    for tup in "${tuples[@]}"; do
      IFS=':' read -r t a r <<< "$tup"
      [ -n "$t" ] && [ -n "$a" ] && [ -n "$r" ] || die "tuple 格式 type:agent:result, 收到 '$tup'"
      cmd_record "$t" "$a" "$r" >/dev/null && n=$((n+1))
    done
    echo "✓ feed: 记 $n 条"
  fi
}

sub="${1:-}"
case "$sub" in
  list)
    grep -vE '^[[:space:]]*#|^[[:space:]]*$' "$TBL" | awk -F'\t' '{printf "  %-14s %s\n",$1,$2}'; exit 0;;
  record) shift; cmd_record "$@";;
  feed)   shift; cmd_feed   "$@";;
  stats)  shift; cmd_stats  "$@";;
  reset)  shift; cmd_reset  "$@";;
  decay)  shift; cmd_decay  "$@";;
  -h|--help) sed -n '2,26p' "$0";;
  '') die "用法: <task-type> [--top] [--sample] | list | record | feed | stats | reset | decay";;
  *)
    ttype="$sub"; shift   # $1 是 task-type
    top=0; sample=0
    while [ "$#" -gt 0 ]; do case "$1" in
      --top) top=1;; --sample) sample=1;; *) die "未知参数 '$1'";; esac; shift; done
    cmd_rank "$ttype" "$top" "$sample";;
esac
