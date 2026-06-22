#!/usr/bin/env bash
# fanout-integrate.sh — Phase 3 整合: 把各 agent worktree 的改动 cherry-pick 回主分支
#
# 取代 SKILL.md 里"遇冲突就 break 整个循环"的裸 shell: 冲突被隔离到单个 agent
# (cherry-pick --abort 保持 main 干净), 其余 agent 继续整合, 最后给一张汇总表。
# 模型 = git worktree (worktree 与主 repo 共享对象库, 主 repo 能 pick worktree 分支的 SHA)。
#
#   --work <repo>          主 repo (cherry-pick 落点; 须 git 仓库)
#   --agents "a b c"       要整合的 agent (worktree 名), 空格分隔
#   --ws-parent <dir>      worktree 父目录 (相对 work 或绝对; 默认 .ccb/workspaces)
#   --onconflict abort|skip  冲突处理: abort=放弃该 agent 保持 main 干净(默认) / skip=留冲突待人解
#   --task <file>          把汇总追加进 TASK 文件 (可选)
#   --dry                  只打印将整合谁, 不动 git
#
# 每个 agent: worktree 有未提交改动 → add+commit(以 agent 身份) → 主 repo cherry-pick 该 SHA。
# 退出码: 0 = 无冲突(全 picked/no-change) / 1 = 有冲突(已隔离, 列在报告里) / 2 = 用法错
set -uo pipefail
die(){ echo "fanout-integrate: $*" >&2; exit 2; }

work=""; agents=""; ws_parent=".ccb/workspaces"; onconflict="abort"; task=""; dry=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --work)       work="${2:-}"; shift 2;;
    --agents)     agents="${2:-}"; shift 2;;
    --ws-parent)  ws_parent="${2:-}"; shift 2;;
    --onconflict) onconflict="${2:-}"; shift 2;;
    --task)       task="${2:-}"; shift 2;;
    --dry)        dry=1; shift;;
    *) die "未知参数 '$1'";;
  esac
done
[ -n "$work" ] || die "需 --work <repo>"
[ -d "$work/.git" ] || git -C "$work" rev-parse --git-dir >/dev/null 2>&1 || die "--work 不是 git 仓库: $work"
[ -n "$agents" ] || die "需 --agents \"a b c\""
case "$onconflict" in abort|skip) ;; *) die "--onconflict 须 abort|skip";; esac

# worktree 绝对路径 (ws_parent 绝对则直用, 否则相对 work)
wt_path(){ case "$ws_parent" in /*) printf '%s/%s' "$ws_parent" "$1";; *) printf '%s/%s/%s' "$work" "$ws_parent" "$1";; esac; }

picked=(); nochange=(); conflict=(); missing=()
report=()

for ag in $agents; do
  wt="$(wt_path "$ag")"
  if [ ! -d "$wt" ]; then missing+=("$ag"); report+=("  ?  missing   $ag  ($wt 不存在)"); continue; fi
  # worktree 内有无改动
  if [ -z "$(git -C "$wt" status --porcelain 2>/dev/null)" ]; then
    nochange+=("$ag"); report+=("  —  no-change $ag"); continue
  fi
  files="$(git -C "$wt" status --porcelain | sed 's/^...//' | tr '\n' ' ')"
  if [ "$dry" -eq 1 ]; then report+=("  ▸  would-pick $ag  ($files)"); picked+=("$ag"); continue; fi

  git -C "$wt" add -A
  git -C "$wt" -c user.email=ccb@local -c user.name="$ag" commit -q -m "$ag: $files" || {
    nochange+=("$ag"); report+=("  —  no-change $ag (commit 空)"); continue; }
  sha="$(git -C "$wt" rev-parse HEAD)"

  # cherry-pick 要建新 commit → 需 committer 身份; 显式带上, 别依赖全局 git config
  # (无全局 identity 的环境如 CI/全新用户 否则会失败, 被误判成 conflict)
  if git -C "$work" -c user.email=ccb@local -c user.name=fanout-integrate cherry-pick "$sha" >/dev/null 2>&1; then
    picked+=("$ag"); report+=("  ✓  picked    $ag  ${sha:0:7}  ($files)")
  else
    if [ "$onconflict" = abort ]; then
      git -C "$work" cherry-pick --abort >/dev/null 2>&1
      conflict+=("$ag"); report+=("  ✗  conflict  $ag  → 已 abort, main 保持干净; 需人工 cherry-pick/rebase $sha")
    else
      conflict+=("$ag"); report+=("  ✗  conflict  $ag  → 冲突留在工作区(skip 模式), 解决后 git cherry-pick --continue")
    fi
  fi
done

# 汇总
hdr="── integrate (work=$work) ──"
sum="$(printf '%s · %s · %s · %s' \
  "${#picked[@]} picked" "${#nochange[@]} no-change" "${#conflict[@]} conflict" "${#missing[@]} missing")"
{ echo "$hdr"; printf '%s\n' "${report[@]}"; echo "$sum"; }

if [ -n "$task" ] && [ -f "$task" ]; then
  { echo ""; echo "### Integrate — $sum"; printf '%s\n' "${report[@]}"; } >> "$task"
  echo "→ 已写入 $task" >&2
fi

[ "${#conflict[@]}" -eq 0 ]
