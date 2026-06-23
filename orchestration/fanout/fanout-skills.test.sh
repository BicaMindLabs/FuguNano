#!/usr/bin/env bash
# fanout-skills.test.sh — skills 母目录: 3 源(user/system/plugin) + 5列catalog + frontmatter解析 + 命令
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
S="$HERE/fanout-skills.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
pass=0; fail=0
ok(){ if eval "$2"; then echo "  ✓ $1"; pass=$((pass+1)); else echo "  ✗ $1"; fail=$((fail+1)); fi; }
has(){ case "$2" in *"$1"*) return 0;; *) return 1;; esac; }   # 子串(避开 grep -P 跨平台)

# user 源: functional(inline) + note(wdkns 前缀) + functional(折叠 >-); system 源; 假 plugin 市场
SK="$TMP/skills"; mkdir -p "$SK/my-tool" "$SK/wdkns-note-1" "$SK/folded-desc" "$SK/.system/sys-tool"
printf -- '---\nname: my-tool\ndescription: A real functional tool for doing X. Use when Y.\n---\n# my-tool body\n' > "$SK/my-tool/SKILL.md"
printf -- '---\nname: wdkns-note-1\ndescription: a learning note about Z\n---\n' > "$SK/wdkns-note-1/SKILL.md"
printf -- '---\nname: folded-desc\ndescription: >-\n  first line of folded\n  second line continues\nmetadata:\n  type: x\n---\nbody\n' > "$SK/folded-desc/SKILL.md"
printf -- '---\nname: sys-tool\ndescription: a SYSTEM meta tool for creating things\n---\n# sys body\n' > "$SK/.system/sys-tool/SKILL.md"
# 假 plugin 市场: marketplaces/<mp>/plugins/<plug>/skills/<skill>/ → id plug:skill
PL="$TMP/plugins"; mkdir -p "$PL/mymp/plugins/myplug/skills/myskill"
printf -- '---\nname: myskill\ndescription: a PLUGIN skill PLUGDESC here\n---\n# plug body\n' > "$PL/mymp/plugins/myplug/skills/myskill/SKILL.md"
export FANOUT_SKILLS_ROOT="$SK" FANOUT_PLUGINS_ROOT="$PL" FANOUT_SKILLS_CATALOG="$TMP/cat.tsv"

echo "fanout-skills tests"

# index: 3 user + 1 system + 1 plugin = 5
out="$(bash "$S" index --refresh)"
ok "index 报 5 个 skill" 'has "5 个 skill" "$out"'
ok "index 分源 user 3" 'has "user    3" "$out" || has "user   3" "$out"'
ok "index 分源 system 1" 'has "system" "$out"'
ok "index 分源 plugin 1" 'has "plugin" "$out"'
ok "catalog 落文件" '[ -s "$FANOUT_SKILLS_CATALOG" ]'

# 5列 catalog: id source type path desc
ok "catalog: my-tool=user functional" 'has "$(printf "my-tool\tuser\tfunctional")" "$(cat "$FANOUT_SKILLS_CATALOG")"'
ok "catalog: wdkns-note-1=user note (前缀分类)" 'has "$(printf "wdkns-note-1\tuser\tnote")" "$(cat "$FANOUT_SKILLS_CATALOG")"'
ok "catalog: sys-tool=system" 'has "$(printf "sys-tool\tsystem")" "$(cat "$FANOUT_SKILLS_CATALOG")"'
ok "catalog: plugin id = myplug:myskill" 'grep -q "myplug:myskill" "$FANOUT_SKILLS_CATALOG"'
ok "catalog 含 path 列(.system 路径)" 'grep -q ".system/sys-tool/SKILL.md" "$FANOUT_SKILLS_CATALOG"'
ok "折叠 >- 描述拼成一行" 'grep -q "first line of folded second line continues" "$FANOUT_SKILLS_CATALOG"'
ok "折叠描述不吸入 metadata" '! grep -q "type: x" "$FANOUT_SKILLS_CATALOG"'

ok "index 已存在 → 不重建" 'has "已存在" "$(bash "$S" index)"'

# list + --source
ok "list functional 含 my-tool" 'bash "$S" list --type functional | grep -q my-tool'
ok "list functional 不含 wdkns note" '! bash "$S" list --type functional | grep -q wdkns-note-1'
ok "list --source system 含 sys-tool" 'bash "$S" list --source system | grep -q sys-tool'
ok "list --source plugin 含 myplug:myskill" 'bash "$S" list --source plugin | grep -q "myplug:myskill"'
ok "list --source system 不含 user 的 my-tool" '! bash "$S" list --source system | grep -q my-tool'

# match (+ --source)
ok "match 'system meta creating' → sys-tool" 'bash "$S" match "system meta creating" | grep -q sys-tool'
ok "match --source plugin 'PLUGDESC' → myplug:myskill" 'bash "$S" match "PLUGDESC plugin" --source plugin | grep -q "myplug:myskill"'

# show: 跨源 path 解析
ok "show sys-tool 解析到 .system 路径 + body" 'bash "$S" show sys-tool | grep -q "sys body"'
ok "show plugin id myplug:myskill → plug body" 'bash "$S" show "myplug:myskill" | grep -q "plug body"'
bash "$S" show no-such >/dev/null 2>&1; ok "show 不存在 → 非0" '[ "$?" -ne 0 ]'

# inject 跨源
out="$(bash "$S" inject "sys-tool,myplug:myskill")"
ok "inject 含 sys-tool .system 路径" 'has ".system/sys-tool/SKILL.md" "$out"'
ok "inject 含 plugin skill" 'has "myplug:myskill" "$out"'
ok "inject --full 内联 plugin body" 'bash "$S" inject "myplug:myskill" --full | grep -q "plug body"'
bash "$S" inject >/dev/null 2>&1; ok "inject 无参 → 非0" '[ "$?" -ne 0 ]'

# 跳过 plugin 源
out="$(FANOUT_SKILLS_NO_PLUGINS=1 bash "$S" index --refresh)"
ok "FANOUT_SKILLS_NO_PLUGINS=1 → 不扫 plugin (4 个)" 'has "4 个 skill" "$out"'

# ── forge: 闭环 沉淀→创建→放回分类 (在 NO_PLUGINS 之后, 免破坏前面计数) ──
mkdir -p "$SK/.system/skill-creator"
printf -- '---\nname: skill-creator\ndescription: official skill authoring guide\n---\nGUIDE\n' > "$SK/.system/skill-creator/SKILL.md"
export FANOUT_EXPERIENCE="$TMP/exp"
MAT="$TMP/material.txt"
printf 'A reusable distilled method long enough to pass the candidate gate: step one do the thing, step two verify via harness, step three commit. Recurred across tasks; keep the procedure. Handle empty input and retry on transient errors.\n' > "$MAT"
bash "$S" index --refresh >/dev/null   # 重建含 skill-creator

out="$(bash "$S" forge --name foo-flow --source "$MAT")"
ok "forge brief 含 skill-creator 调用" 'has "skill-creator" "$out"'
ok "forge brief 含 name + 料" 'has "foo-flow" "$out" && has "verify via harness" "$out"'
ok "forge brief 含 index --refresh 闭环提示" 'has "index --refresh" "$out"'
printf '短\n' | bash "$S" forge --name tiny --material >/dev/null 2>&1; ok "forge 候选门: 料太薄 → 非0" '[ "$?" -ne 0 ]'
bash "$S" forge --source "$MAT" >/dev/null 2>&1; ok "forge 缺 --name → 非0" '[ "$?" -ne 0 ]'
bash "$S" forge --name x >/dev/null 2>&1; ok "forge 无取料 → 非0" '[ "$?" -ne 0 ]'

bash "$HERE/fanout-experience.sh" add code "distilled method" --from "$MAT" >/dev/null 2>&1
out="$(bash "$S" forge --name from-exp --from-experience code/distilled-method)"
ok "forge --from-experience 取经验 body 进 brief" 'has "verify via harness" "$out"'
bash "$S" forge --name x --from-experience badformat >/dev/null 2>&1; ok "forge --from-experience 坏格式 → 非0" '[ "$?" -ne 0 ]'

# --agent 派活: brief + skill-creator 注入进 worker stdin (ccb stub)
CCBSTUB="$TMP/ccb"; printf '#!/usr/bin/env bash\ncat > "%s"\n' "$TMP/forge-called" > "$CCBSTUB"; chmod +x "$CCBSTUB"
FANOUT_CCB="$CCBSTUB" bash "$S" forge --name viaworker --source "$MAT" --agent cc-x >/dev/null 2>&1
ok "forge --agent: brief 进 worker stdin" 'grep -q "viaworker" "$TMP/forge-called"'
ok "forge --agent: skill-creator 被注入" 'grep -q "official skill authoring guide" "$TMP/forge-called"'

# ── validate: 质量门 (镜像官方 quick_validate.py) ──
vmk(){ mkdir -p "$SK/$1"; printf -- '%s' "$2" > "$SK/$1/SKILL.md"; }
vmk v-good '---
name: v-good
description: a valid skill desc with triggers
metadata:
  k: v
---
body'
vmk v-badname '---
name: Bad_Name
description: ok
---'
vmk v-nodesc '---
name: v-nodesc
---'
vmk v-angle '---
name: v-angle
description: has <x> brackets
---'
vmk v-badkey '---
name: v-badkey
description: ok
weird_key: 1
---'
vmk v-folded '---
name: v-folded
description: >-
  folded one
  folded two
---'
bash "$S" validate --dir "$SK/v-good" >/dev/null 2>&1;   ok "validate 合法 → exit 0" '[ "$?" -eq 0 ]'
bash "$S" validate --dir "$SK/v-folded" >/dev/null 2>&1; ok "validate 折叠描述合法 → exit 0" '[ "$?" -eq 0 ]'
bash "$S" validate --dir "$SK/v-badname" >/dev/null 2>&1; ok "validate 非 hyphen-case name → 非0" '[ "$?" -ne 0 ]'
bash "$S" validate --dir "$SK/v-nodesc" >/dev/null 2>&1;  ok "validate 缺 description → 非0" '[ "$?" -ne 0 ]'
bash "$S" validate --dir "$SK/v-angle" >/dev/null 2>&1;   ok "validate 描述含尖括号 → 非0" '[ "$?" -ne 0 ]'
bash "$S" validate --dir "$SK/v-badkey" >/dev/null 2>&1;  ok "validate 非法 frontmatter key → 非0" '[ "$?" -ne 0 ]'
bash "$S" validate --dir "$TMP/nonexist" >/dev/null 2>&1; ok "validate 无 SKILL.md → 非0" '[ "$?" -ne 0 ]'
out="$(bash "$S" validate --dir "$SK/v-good" 2>&1)"; ok "validate 合法报 ✓ valid" 'case "$out" in *"✓ valid"*) true;; *) false;; esac'
bash "$S" validate --dir "$SK/v-good" --official >/dev/null 2>&1; ok "validate --official 无 quick_validate 回退内置仍过" '[ "$?" -eq 0 ]'

# 闭环(带验收门): forge → (worker 写 skill) → validate 过 → index --refresh → 进母目录
mkdir -p "$SK/forged-skill"; printf -- '---\nname: forged-skill\ndescription: a freshly forged skill\n---\nbody\n' > "$SK/forged-skill/SKILL.md"
bash "$S" validate forged-skill --dir "$SK/forged-skill" >/dev/null 2>&1; ok "闭环: forge 产物过验收门" '[ "$?" -eq 0 ]'
bash "$S" index --refresh >/dev/null
ok "闭环: 校验通过的 skill 重 index 后进母目录" 'bash "$S" list --type functional | grep -q forged-skill'
# 负向闭环: 不合格 skill 被门拦下 (不该进母目录)
mkdir -p "$SK/Bad-Forge"; printf -- '---\nname: Bad_Forge\ndescription: invalid\n---\n' > "$SK/Bad-Forge/SKILL.md"
bash "$S" validate --dir "$SK/Bad-Forge" >/dev/null 2>&1; ok "负向闭环: 不合格 skill 被验收门拦下(非0)" '[ "$?" -ne 0 ]'

bash "$S" bogus >/dev/null 2>&1; ok "未知子命令 → 非0" '[ "$?" -ne 0 ]'

echo "fanout-skills: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
