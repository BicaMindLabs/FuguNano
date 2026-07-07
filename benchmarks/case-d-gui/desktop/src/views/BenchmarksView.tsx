import data from '../data/benchmarks.json';
import { useT } from '../i18n';
import type { Lang } from '../i18n';

interface Config {
  readonly name: string;
  readonly name_zh?: string;
  readonly kind: string;
  readonly score: number;
  readonly total: number;
}
interface Suite {
  readonly id: string;
  readonly title: string;
  readonly title_zh: string;
  readonly gate: boolean;
  readonly note: string;
  readonly note_zh: string;
  readonly configs: readonly Config[];
}

const barColor = (kind: string): string =>
  kind === 'fanout'
    ? 'var(--green-700)'
    : kind === 'premium'
      ? 'var(--blue-700)'
      : kind === 'router'
        ? 'var(--amber-700)'
        : 'var(--gray-700)';

function SuiteCard({ s, lang, gateLabel }: { s: Suite; lang: Lang; gateLabel: string }): JSX.Element {
  const max = Math.max(...s.configs.map((c) => c.total));
  return (
    <section className="panel">
      <div className="suite-head">
        <h2>
          {s.id} · {lang === 'zh' ? s.title_zh : s.title}
        </h2>
        <span className={`gate-tag ${s.gate ? 'has-gate' : 'no-gate'}`}>{gateLabel}</span>
      </div>
      <p className="hint">{lang === 'zh' ? s.note_zh : s.note}</p>
      <div className="bars">
        {s.configs.map((c) => (
          <div className="bar-row" key={c.name}>
            <span className="bar-label">{lang === 'zh' && c.name_zh ? c.name_zh : c.name}</span>
            <div className="bar-track">
              <div
                className="bar-fill"
                style={{ width: `${(c.score / max) * 100}%`, background: barColor(c.kind) }}
              />
            </div>
            <span className="bar-val mono">
              {c.score}/{c.total}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function BenchmarksView(): JSX.Element {
  const { t, lang } = useT();
  const suites = data.suites as readonly Suite[];
  const sk = data.skepticHeldOut;
  const gateLabel = (gate: boolean): string => t(gate ? 'bench.hasGate' : 'bench.noGate');
  return (
    <div className="benchmarks">
      <section className="panel thesis-card">
        <h2>{t('bench.finding')}</h2>
        <p className="thesis">{lang === 'zh' ? data.thesis_zh : data.thesis}</p>
      </section>

      {suites.map((s) => (
        <SuiteCard key={s.id} s={s} lang={lang} gateLabel={gateLabel(s.gate)} />
      ))}

      <section className="panel">
        <div className="suite-head">
          <h2>{lang === 'zh' ? sk.title_zh : sk.title}</h2>
          <span className="gate-tag has-gate">+{sk.deltaPp}pp</span>
        </div>
        <p className="hint">{lang === 'zh' ? sk.note_zh : sk.note}</p>
        <div className="skeptic">
          <div className="sk-col">
            <div className="sk-num" style={{ color: 'var(--gray-700)' }}>{sk.baselinePct}%</div>
            <div className="muted">{t('bench.baseline')}</div>
          </div>
          <div className="sk-arrow">→</div>
          <div className="sk-col">
            <div className="sk-num" style={{ color: 'var(--green-700)' }}>{sk.skepticPct}%</div>
            <div className="muted">{t('bench.skeptic')}</div>
          </div>
          <div className="sk-facts">
            <div className="meta"><span>{t('bench.regressions')}</span><span className="mono">{sk.regressions}</span></div>
            <div className="meta"><span>{t('bench.significance')}</span><span className="mono">{sk.significance}</span></div>
          </div>
        </div>
      </section>

      <p className="hint src">{lang === 'zh' ? data.sources_zh : data.sources}</p>
    </div>
  );
}
