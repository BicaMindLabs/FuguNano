import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

// Minimal runtime i18n — no dependency, no bundler magic. A flat key → string dict per language,
// a Context that holds the current language, and a useT() hook returning a typed t(key). The choice
// persists to localStorage so it survives reloads.

export type Lang = 'en' | 'zh';

const en = {
  'app.title': 'FuguNano Studio',
  'app.subtitle': 'orchestration console',
  'app.toggleTheme': 'Toggle theme',
  'app.toggleLang': 'Switch language',

  'nav.pipeline': 'Pipeline',
  'nav.rounds': 'Rounds',
  'nav.selector': 'Selector',
  'nav.benchmarks': 'Benchmarks',

  'pipeline.goalPlaceholder': 'Describe the task goal…',
  'pipeline.planTask': 'Plan Task',
  'pipeline.repoPlaceholder': 'Repo work dir (path)…',
  'pipeline.dispatch': 'Dispatch',
  'pipeline.integrate': 'Integrate',
  'pipeline.review': 'Review',
  'pipeline.loop': 'Loop',
  'pipeline.taskLog': 'Task Log',
  'pipeline.noCommands': 'No commands yet. Describe a goal and run Plan Task.',
  'pipeline.agents': 'Agents',
  'pipeline.loading': 'Loading…',
  'pipeline.task': 'Task',
  'pipeline.file': 'file',
  'pipeline.phase': 'phase',
  'pipeline.lastExit': 'last exit',

  'rounds.title': 'Rounds',
  'rounds.refreshList': 'Refresh list',
  'rounds.none': 'No rounds in cache.',
  'rounds.selectRound': 'Select a round.',
  'rounds.refresh': 'Refresh',
  'rounds.total': 'total',
  'rounds.done': 'done',
  'rounds.fail': 'fail',
  'rounds.pending': 'pending',
  'rounds.agents': 'Agents',

  'selector.candidates': 'Candidates',
  'selector.agent': 'agent',
  'selector.gate': 'gate',
  'selector.answerLabel': 'answer label',
  'selector.addCandidate': '+ candidate',
  'selector.categoryPlaceholder': 'category (e.g. security)',
  'selector.hint':
    "Set a gate result (✓/✗) to simulate a verifier; leave gates unset and use answer labels to simulate consensus. A live preview mirrors the engine's route().",
  'selector.orRoute': 'Or route a real fan-out round',
  'selector.roundN': 'round n',
  'selector.gateCmd': 'gate cmd (optional, e.g. ./run-tests.sh)',
  'selector.route': 'Route',
  'selector.backToPreview': 'back to preview',
  'selector.reason': 'reason',
  'selector.pick': 'pick',
  'selector.agreement': 'agreement',
  'selector.exitCode': 'exit code',
  'selector.noJson': 'route emitted no JSON — showing raw output below.',
  'selector.verifierLadder': 'Verifier ladder',

  'ladder.gate': 'executable gate',
  'ladder.gateNote': 'the only clean TRUST',
  'ladder.synth': 'synthesized gate',
  'ladder.synthNote': 'property tests / static rules',
  'ladder.skeptic': 'skeptic pre-pass',
  'ladder.skepticNote': 'category-level challenge',
  'ladder.judge': 'model judge',
  'ladder.consensus': 'consensus',
  'ladder.consensusNote': 'cheap, fails correlated',
  'ladder.escalate': 'escalate to premium',

  'reason.gate-verified': 'A verifier vouched for a candidate — the only clean trust.',
  'reason.gate-failed': 'A gate ran but every candidate failed — nothing to trust.',
  'reason.forced-category': 'High-risk category — consensus is known-unreliable here, so escalate.',
  'reason.quorum': 'No gate, but a dominant answer cluster passed the trust threshold.',
  'reason.split': 'No gate and no dominant cluster — the fleet split.',
  'reason.singleton': 'A lone unverified candidate with no corroboration.',
  'reason.empty': 'Nothing to decide.',

  'bench.finding': 'The finding',
  'bench.hasGate': 'has gate',
  'bench.noGate': 'no gate',
  'bench.baseline': 'baseline',
  'bench.skeptic': '+ skeptic',
  'bench.regressions': 'regressions',
  'bench.significance': 'significance',
} as const;

export type MsgKey = keyof typeof en;

const zh: Record<MsgKey, string> = {
  'app.title': 'FuguNano Studio',
  'app.subtitle': '编排控制台',
  'app.toggleTheme': '切换主题',
  'app.toggleLang': '切换语言',

  'nav.pipeline': '流水线',
  'nav.rounds': '轮次',
  'nav.selector': '路由决策',
  'nav.benchmarks': '基准',

  'pipeline.goalPlaceholder': '描述任务目标…',
  'pipeline.planTask': '规划任务',
  'pipeline.repoPlaceholder': '仓库工作目录(路径)…',
  'pipeline.dispatch': '派发',
  'pipeline.integrate': '整合',
  'pipeline.review': '审查',
  'pipeline.loop': '循环',
  'pipeline.taskLog': '任务日志',
  'pipeline.noCommands': '还没有命令。填一个目标,点「规划任务」。',
  'pipeline.agents': '智能体',
  'pipeline.loading': '加载中…',
  'pipeline.task': '任务',
  'pipeline.file': '文件',
  'pipeline.phase': '阶段',
  'pipeline.lastExit': '上次退出码',

  'rounds.title': '轮次',
  'rounds.refreshList': '刷新列表',
  'rounds.none': '缓存里没有轮次。',
  'rounds.selectRound': '选择一个轮次。',
  'rounds.refresh': '刷新',
  'rounds.total': '总数',
  'rounds.done': '完成',
  'rounds.fail': '失败',
  'rounds.pending': '待定',
  'rounds.agents': '智能体',

  'selector.candidates': '候选',
  'selector.agent': '智能体',
  'selector.gate': '验证',
  'selector.answerLabel': '答案标签',
  'selector.addCandidate': '+ 候选',
  'selector.categoryPlaceholder': '类别(如 security)',
  'selector.hint':
    '给一行设置验证结果(✓/✗)来模拟验证器;不设验证、用答案标签来模拟共识。实时预览逐行镜像引擎的 route()。',
  'selector.orRoute': '或路由一个真实的 fan-out 轮次',
  'selector.roundN': '轮次号',
  'selector.gateCmd': '验证命令(可选,如 ./run-tests.sh)',
  'selector.route': '路由',
  'selector.backToPreview': '返回预览',
  'selector.reason': '原因',
  'selector.pick': '选中',
  'selector.agreement': '一致度',
  'selector.exitCode': '退出码',
  'selector.noJson': 'route 没有输出 JSON —— 下方显示原始输出。',
  'selector.verifierLadder': '验证器阶梯',

  'ladder.gate': '可执行验证门',
  'ladder.gateNote': '唯一干净的 TRUST',
  'ladder.synth': '合成验证门',
  'ladder.synthNote': '属性测试 / 静态规则',
  'ladder.skeptic': '怀疑者预检',
  'ladder.skepticNote': '类别级挑战',
  'ladder.judge': '模型评审',
  'ladder.consensus': '共识',
  'ladder.consensusNote': '便宜,但会相关性失效',
  'ladder.escalate': '升级到高级模型',

  'reason.gate-verified': '有验证器为某候选背书 —— 唯一干净的信任。',
  'reason.gate-failed': '验证门跑了但所有候选都失败 —— 没有可信的。',
  'reason.forced-category': '高风险类别 —— 这里共识已知不可靠,直接升级。',
  'reason.quorum': '没有验证门,但一个占多数的答案簇过了信任阈值。',
  'reason.split': '没有验证门也没有占多数的簇 —— 车队分裂了。',
  'reason.singleton': '一个孤立的、未验证的候选,没有旁证。',
  'reason.empty': '没有可决策的内容。',

  'bench.finding': '结论',
  'bench.hasGate': '有验证门',
  'bench.noGate': '无验证门',
  'bench.baseline': '基线',
  'bench.skeptic': '+ 怀疑者',
  'bench.regressions': '回退',
  'bench.significance': '显著性',
};

const dict: Record<Lang, Record<MsgKey, string>> = { en, zh };

interface LangCtx {
  readonly lang: Lang;
  readonly setLang: (l: Lang) => void;
  readonly t: (key: MsgKey) => string;
}

const Ctx = createContext<LangCtx | null>(null);

const STORAGE_KEY = 'fugunano.lang';
const readInitial = (): Lang => {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'en' || v === 'zh') return v;
  } catch {
    /* ignore */
  }
  return 'en';
};

export function LangProvider({ children }: { children: ReactNode }): JSX.Element {
  const [lang, setLangState] = useState<Lang>(readInitial);

  useEffect(() => {
    document.documentElement.setAttribute('lang', lang === 'zh' ? 'zh-CN' : 'en');
  }, [lang]);

  const value = useMemo<LangCtx>(
    () => ({
      lang,
      setLang: (l) => {
        setLangState(l);
        try {
          localStorage.setItem(STORAGE_KEY, l);
        } catch {
          /* ignore */
        }
      },
      t: (key) => dict[lang][key],
    }),
    [lang],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useT(): LangCtx {
  const ctx = useContext(Ctx);
  if (ctx === null) throw new Error('useT must be used within <LangProvider>');
  return ctx;
}
