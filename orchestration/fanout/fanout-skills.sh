#!/usr/bin/env bash
# fanout-skills.sh — 本机 skills 总目录(母目录)+ 按需注入给 agent (progressive disclosure)
#
# fanout 哲学 = 只喂该看的。本机几百个 skill, 不能全塞给每个 (弱)agent。流程:
#   ① index  扫所有 skill 源的 SKILL.md frontmatter → 紧凑 catalog(母目录)
#   ② (Planner 读 catalog 把 skills 分给子任务/agent — 这步是判断, 不是工具)
#   ③ inject 把选中的 skill 注成 context, 由 `dispatch --skills` 喂给那个 agent 去爬
#
# 三个 skill 源(都纳入母目录, 用 source 列区分):
#   user   ~/.claude/skills/<name>/         你的 skill
#   system ~/.claude/skills/.system/<name>/ 系统元技能(skill-creator/plugin-creator/skill-installer/imagegen/openai-docs)
#   plugin ~/.claude/plugins/marketplaces/.../skills/<name>/  插件市场 skill(官方 + cn/impeccable/codex…); id=plugin:skill
#
#   index [--refresh]                重建 catalog (默认 缺失才建; --refresh 强制)
#   list  [--type functional|note|all] [--source user|system|plugin|all]   列 catalog
#   match "<query>" [--type t] [--source s] [--limit N]   grep 匹配相关 skill (排序 by 命中数)
#   show  <id>                       打印某 skill 的路径 + SKILL.md (供爬取)
#   inject <id1,id2,...> [--full]    生成可注入 prompt 的 skill context 块 (--full 内联 SKILL.md 全文)
#   validate <id> | --dir <d> [--official]   skill 质量门(镜像官方 quick_validate; --official 用本机 quick_validate.py)
#   forge --name <id> (--from-experience <ws/slug> | --source <f> | --material<stdin>) [--agent A] [--harness h] [--target-dir d] [--min-chars N]
#        闭环'沉淀→创建→放回分类': 取料 → 候选门(料够厚) → 组装 authoring brief → (--agent 则派 worker 注入
#        skill-creator 去写; 否则打印 brief) → 提示 `skills index --refresh` 收进母目录。委托 authoring 给 skill-creator, 不重造蒸馏。
#   env: FANOUT_SKILLS_ROOT(默认 ~/.claude/skills) FANOUT_PLUGINS_ROOT(默认 ~/.claude/plugins/marketplaces)
#        FANOUT_SKILLS_CATALOG(catalog 路径) FANOUT_SKILLS_NOTE_RE(note 前缀正则) FANOUT_SKILLS_NO_PLUGINS=1(跳过 plugin)
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${FANOUT_SKILLS_ROOT:-$HOME/.claude/skills}"
PLUGINS="${FANOUT_PLUGINS_ROOT:-$HOME/.claude/plugins/marketplaces}"
CATALOG="${FANOUT_SKILLS_CATALOG:-${FANOUT_STATE:-$HOME/.config/fanout}/skills-catalog.tsv}"
NOTE_RE="${FANOUT_SKILLS_NOTE_RE:-^(wdkns|book|csdiy|dlai|mit|mooc|child|tu-online)}"
die(){ echo "fanout-skills: $*" >&2; exit 2; }

# 共享 awk: 读 SKILL.md, 解析 frontmatter, 输出 "id<TAB>source<TAB>type<TAB>path<TAB>desc"
# -v src=来源  -v idmode=dirname|plugin (plugin: .../plugins/<P>/skills/<S>/ → P:S)
_AWK='
  function pid(  n,p,i,plug,sk){ n=split(FILENAME,p,"/")
    if(idmode=="plugin"){ plug="";sk=""
      for(i=1;i<=n;i++){ if(p[i]=="plugins")plug=p[i+1]; if(p[i]=="skills")sk=p[i+1] }
      if(plug!="" && sk!="") return plug":"sk
      return p[n-1] }
    return p[n-1] }
  function flush(){ if(id!=""){ gsub(/^[ \t]+|[ \t]+$/,"",desc); gsub(/[ \t]+/," ",desc)
      if(length(desc)>160) desc=substr(desc,1,157)"..."
      t=(id ~ note_re)?"note":"functional"
      printf "%s\t%s\t%s\t%s\t%s\n", id, src, t, path, desc } }
  FNR==1{ flush(); id=pid(); path=FILENAME; desc=""; infront=0; fc=0; indesc=0 }
  /^---[ \t]*$/{ fc++; if(fc==1){infront=1;next} if(fc>=2){infront=0} next }
  infront && /^description:/{ r=$0; sub(/^description:[ \t]*/,"",r)
    if(r ~ /^[>|]/ || r==""){ desc=""; indesc=1 } else { desc=r; indesc=0 } next }
  infront && indesc && /^[ \t]/{ l=$0; sub(/^[ \t]+/,"",l); desc=desc" "l; next }
  infront && /^[A-Za-z_]+:/{ indesc=0 }
  END{ flush() }'

_scan_into(){ # <find-cmd via stdin null-list> <src> <idmode>
  xargs -0 awk -v note_re="$NOTE_RE" -v src="$2" -v idmode="$3" "$_AWK"
}
_scan(){
  {
    find "$ROOT" -mindepth 2 -maxdepth 2 -name SKILL.md -not -path '*/.system/*' -print0 2>/dev/null | _scan_into - user   dirname
    find "$ROOT/.system" -mindepth 2 -maxdepth 2 -name SKILL.md -print0 2>/dev/null              | _scan_into - system dirname
    if [ "${FANOUT_SKILLS_NO_PLUGINS:-0}" != 1 ] && [ -d "$PLUGINS" ]; then
      find "$PLUGINS" -name SKILL.md -print0 2>/dev/null | _scan_into - plugin plugin
    fi
  } | sort -t"$(printf '\t')" -k1,1 -u   # 按 id 去重(避开 plugin cache 重复)
}

cmd_index(){
  local refresh=0; [ "${1:-}" = "--refresh" ] && refresh=1
  [ -d "$ROOT" ] || die "无 skills 根: $ROOT"
  if [ "$refresh" -eq 0 ] && [ -s "$CATALOG" ]; then
    echo "✓ catalog 已存在: $CATALOG ($(grep -c . "$CATALOG") 条; --refresh 重建)"; return 0
  fi
  mkdir -p "$(dirname "$CATALOG")"
  _scan > "$CATALOG.tmp" && mv -f "$CATALOG.tmp" "$CATALOG"
  local n; n="$(grep -c . "$CATALOG")"
  echo "✓ catalog 建好: $CATALOG — $n 个 skill"
  awk -F'\t' '$1!=""{ s[$2]++; if($3=="functional") sf[$2]++ } END{ for(k in s) printf "   %-7s %d (%d functional)\n",k,s[k],sf[k]+0 }' "$CATALOG"
}

_need_catalog(){ [ -s "$CATALOG" ] || cmd_index >/dev/null; }

cmd_list(){
  local type="functional" source="all"
  while [ "$#" -gt 0 ]; do case "$1" in
    --type) type="${2:-}"; shift 2;; --source) source="${2:-}"; shift 2;; *) die "未知参数 '$1'";; esac
  done
  _need_catalog
  awk -F'\t' -v t="$type" -v s="$source" '$1!=""{
    if((t=="all"||$3==t) && (s=="all"||$2==s)) printf "  %-42s %-7s %-11s %s\n",$1,$2,$3,substr($5,1,82) }' "$CATALOG"
}

cmd_match(){
  local query="" type="all" source="all" limit=10
  while [ "$#" -gt 0 ]; do case "$1" in
    --type) type="${2:-}"; shift 2;; --source) source="${2:-}"; shift 2;; --limit) limit="${2:-10}"; shift 2;;
    -*) die "未知参数 '$1'";; *) query="${query:+$query }$1"; shift;; esac
  done
  [ -n "$query" ] || die "用法: match \"<query>\" [--type t] [--source s] [--limit N]"
  _need_catalog
  awk -F'\t' -v q="$query" -v type="$type" -v src="$source" '
    $1=="" {next}
    { if(type!="all" && $3!=type) next; if(src!="all" && $2!=src) next
      hay=tolower($1" "$5); nq=split(tolower(q),qa," "); hits=0
      for(i=1;i<=nq;i++){ w=qa[i]; if(w!="" && index(hay,w)) hits++ }
      if(hits>0) printf "%d\t%s\t%s\t%s\t%s\n", hits,$1,$2,$3,$5 }' "$CATALOG" \
    | sort -t"$(printf '\t')" -k1,1nr -k2,2 | head -n "$limit" \
    | awk -F'\t' '{printf "  [%s] %-38s %-7s %-11s %s\n",$1,$2,$3,$4,substr($5,1,72)}'
}

# id → SKILL.md 路径 (先查 catalog 的 path 列; 查不到再按 user 目录兜底)
_path_of(){ _need_catalog; local p; p="$(awk -F'\t' -v k="$1" '$1==k{print $4; exit}' "$CATALOG")"
  [ -n "$p" ] && { printf '%s' "$p"; return 0; }
  [ -f "$ROOT/$1/SKILL.md" ] && printf '%s' "$ROOT/$1/SKILL.md"; }

cmd_show(){
  local id="${1:-}"; [ -n "$id" ] || die "用法: show <skill-id>"
  local f; f="$(_path_of "$id")"; [ -n "$f" ] && [ -f "$f" ] || die "无此 skill: $id"
  echo "── $id — $f ──"; cat "$f"
}

cmd_inject(){
  local ids="" full=0
  while [ "$#" -gt 0 ]; do case "$1" in --full) full=1; shift;; -*) die "未知参数 '$1'";; *) ids="$1"; shift;; esac; done
  [ -n "$ids" ] || die "用法: inject <id1,id2,...> [--full]"
  _need_catalog
  echo "[Skills available for this task — crawl only the ones you need]"
  local IFS=','; local id
  for id in $ids; do
    [ -n "$id" ] || continue
    local f desc
    f="$(_path_of "$id")"; desc="$(awk -F'\t' -v k="$id" '$1==k{print $5; exit}' "$CATALOG")"
    if [ "$full" -eq 1 ] && [ -n "$f" ] && [ -f "$f" ]; then
      echo ""; echo "===== SKILL: $id ====="; cat "$f"
    else
      printf -- '- %s (%s): %s\n' "$id" "${f:-?}" "${desc:-?}"
    fi
  done
  [ "$full" -eq 1 ] || echo "Invoke a needed skill with the Skill tool, or Read its SKILL.md path above."
}

# validate: skill 进母目录前的质量门 (镜像官方 skill-creator quick_validate.py; 自包含, 无 PyYAML 依赖)
#   --official: 本机有 quick_validate.py + python3+pyyaml 时优先用官方那个; 否则走内置
cmd_validate(){
  local id="" dir="" official=0
  while [ "$#" -gt 0 ]; do case "$1" in
    --dir) dir="${2:-}"; shift 2;; --official) official=1; shift;; -*) die "未知参数 '$1'";; *) id="$1"; shift;; esac
  done
  if [ -z "$dir" ]; then
    [ -n "$id" ] || die "用法: validate <skill-id> | validate --dir <skill-dir> [--official]"
    local p; p="$(_path_of "$id" 2>/dev/null)"
    if [ -n "$p" ]; then dir="$(dirname "$p")"; else dir="$ROOT/$id"; fi
  fi
  local md="$dir/SKILL.md"
  # --official: skill-creator 官方 quick_validate.py (若 python3+pyyaml 可用)
  if [ "$official" -eq 1 ]; then
    local qv
    for qv in "$ROOT/.system/skill-creator/scripts/quick_validate.py" "$PLUGINS"/*/plugins/skill-creator/scripts/quick_validate.py; do
      [ -f "$qv" ] || continue
      if command -v python3 >/dev/null 2>&1 && python3 -c 'import yaml' >/dev/null 2>&1; then
        echo "(用官方 quick_validate.py)"; python3 "$qv" "$dir"; return $?
      fi
    done
    echo "(官方 quick_validate.py/pyyaml 不可用 → 走内置校验)" >&2
  fi
  # 内置校验 (镜像 quick_validate.py 的检查)
  [ -f "$md" ] || { echo "✗ SKILL.md not found ($md)"; return 1; }
  head -1 "$md" | grep -qx -- '---' || { echo "✗ 无 YAML frontmatter (须以 --- 开头)"; return 1; }
  local badkeys; badkeys="$(awk 'NR==1&&/^---/{f=1;next} f&&/^---/{exit}
    f&&/^[A-Za-z][A-Za-z0-9_-]*:/{k=$0;sub(/:.*/,"",k); if(k!="name"&&k!="description"&&k!="license"&&k!="allowed-tools"&&k!="metadata")print k}' "$md")"
  [ -z "$badkeys" ] || { echo "✗ frontmatter 含非法 key: $(echo "$badkeys"|tr '\n' ' ')(允许 name/description/license/allowed-tools/metadata)"; return 1; }
  local name; name="$(awk 'NR==1&&/^---/{f=1;next} f&&/^---/{exit} f&&/^name:/{sub(/^name:[ \t]*/,"");sub(/[ \t]*$/,"");print;exit}' "$md")"
  [ -n "$name" ] || { echo "✗ frontmatter 缺 name"; return 1; }
  printf '%s' "$name" | grep -qE '^[a-z0-9-]+$' || { echo "✗ name '$name' 须 hyphen-case (小写字母/数字/连字符)"; return 1; }
  printf '%s' "$name" | grep -qE '(^-|-$|--)' && { echo "✗ name '$name' 不能首尾连字符或连续 --"; return 1; }
  [ "${#name}" -le 64 ] || { echo "✗ name 过长 (${#name}>64)"; return 1; }
  local desc; desc="$(awk 'NR==1&&/^---/{f=1;next} f&&/^---/{exit}
    f&&/^description:/{r=$0;sub(/^description:[ \t]*/,"",r); if(r~/^[>|]/||r==""){indesc=1;d=""}else{d=r} next}
    f&&indesc&&/^[ \t]/{l=$0;sub(/^[ \t]+/,"",l);d=(d==""?l:d" "l);next}
    f&&indesc&&/^[A-Za-z_]+:/{indesc=0} END{print d}' "$md")"
  [ -n "$desc" ] || { echo "✗ frontmatter 缺 description"; return 1; }
  case "$desc" in *"<"*|*">"*) echo "✗ description 不能含尖括号 (< 或 >)"; return 1;; esac
  [ "${#desc}" -le 1024 ] || { echo "✗ description 过长 (${#desc}>1024)"; return 1; }
  echo "✓ valid: $name ($dir)"; return 0
}

# forge: 闭环'沉淀→创建→放回分类' 的编排器 (委托 authoring 给 skill-creator, 不重造)
cmd_forge(){
  local name="" fromexp="" source="" from_stdin=0 agent="" harness="ccb" targetdir="$ROOT" minchars=200
  while [ "$#" -gt 0 ]; do case "$1" in
    --name)            name="${2:-}"; shift 2;;
    --from-experience) fromexp="${2:-}"; shift 2;;
    --source)          source="${2:-}"; shift 2;;
    --material)        from_stdin=1; shift;;
    --agent)           agent="${2:-}"; shift 2;;
    --harness)         harness="${2:-}"; shift 2;;
    --target-dir)      targetdir="${2:-}"; shift 2;;
    --min-chars)       minchars="${2:-}"; shift 2;;
    *) die "未知参数 '$1'";;
  esac; done
  [ -n "$name" ] || die "需 --name <skill-id>"
  # 取料
  local material=""
  if [ -n "$fromexp" ]; then
    local ws="${fromexp%%/*}" slug="${fromexp#*/}"
    [ "$ws" != "$fromexp" ] && [ -n "$slug" ] || die "--from-experience 格式 <ws>/<slug>"
    material="$(bash "$HERE/fanout-experience.sh" show "$ws" "$slug" 2>/dev/null | sed '1,/^---$/d; /^---$/d')"
    [ -n "$material" ] || die "取经验失败/为空: $fromexp"
  elif [ -n "$source" ]; then
    [ -f "$source" ] || die "无 --source 文件 $source"; material="$(cat "$source")"
  elif [ "$from_stdin" -eq 1 ]; then
    material="$(cat)"
  else die "需取料: --from-experience <ws/slug> | --source <f> | --material(stdin)"; fi
  # 候选门: 料太薄不值得沉淀成 skill (借 wdkns-child-013 skill 候选门思路)
  [ "${#material}" -ge "$minchars" ] 2>/dev/null || die "料太薄(${#material}<$minchars 字符) — 先让方法成熟/重复出现再 forge(候选门)"

  local target="$targetdir/$name" brief; brief="$(mktemp)"
  {
    echo "Author a new Claude Code skill named \`$name\` using the **skill-creator** skill (injected above — follow its conciseness / degrees-of-freedom / frontmatter guidance)."
    echo ""
    echo "Write it to \`$target/SKILL.md\` (create the dir). Frontmatter needs \`name: $name\` + a \`description:\` with trigger phrases. Keep it concise."
    echo ""
    echo "Distill it from this precipitated material (a reusable method from prior work — keep the procedure, drop one-off specifics):"
    echo ""
    echo "<<<MATERIAL"
    printf '%s\n' "$material"
    echo "MATERIAL"
    echo ""
    echo "When done, print: DONE: $target/SKILL.md"
  } > "$brief"

  if [ -n "$agent" ]; then
    echo "▸ forge: 派 $agent (注入 skill-creator) 写 skill '$name' → $target"
    bash "$HERE/fanout-dispatch.sh" "$agent" --harness "$harness" --skills skill-creator --prompt-file "$brief"; local rc=$?
    rm -f "$brief"
    echo "→ worker 写完后跑验收门 + 回灌: \`fanout skills validate $name && fanout skills index --refresh\`"
    return "$rc"
  fi
  echo "── forge brief (name=$name · target=$target) — 交给 worker / skill-creator 执行 ──"
  cat "$brief"; rm -f "$brief"
  echo ""
  echo "→ skill 写好后过验收门再回灌母目录(闭环): \`fanout skills validate $name && fanout skills index --refresh\`"
}

sub="${1:-}"; shift || true
case "$sub" in
  index)    cmd_index    "$@";;
  list)     cmd_list     "$@";;
  match)    cmd_match    "$@";;
  show)     cmd_show     "$@";;
  inject)   cmd_inject   "$@";;
  validate) cmd_validate "$@";;
  forge)    cmd_forge    "$@";;
  ''|-h|--help) sed -n '2,27p' "$0";;
  *) die "未知子命令 '$sub' (index|list|match|show|inject|validate|forge)";;
esac
