import data from '../data/benchmarks.json';

interface Config {
  readonly name: string;
  readonly kind: string;
  readonly score: number;
  readonly total: number;
}
interface Suite {
  readonly id: string;
  readonly title: string;
  readonly gate: boolean;
  readonly note: string;
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

function SuiteCard({ s }: { s: Suite }): JSX.Element {
  const max = Math.max(...s.configs.map((c) => c.total));
  return (
    <section className="panel">
      <div className="suite-head">
        <h2>
          {s.id} · {s.title}
        </h2>
        <span className={`gate-tag ${s.gate ? 'has-gate' : 'no-gate'}`}>{s.gate ? 'has gate' : 'no gate'}</span>
      </div>
      <p className="hint">{s.note}</p>
      <div className="bars">
        {s.configs.map((c) => (
          <div className="bar-row" key={c.name}>
            <span className="bar-label">{c.name}</span>
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
  const suites = data.suites as readonly Suite[];
  const sk = data.skepticHeldOut;
  return (
    <div className="benchmarks">
      <section className="panel thesis-card">
        <h2>The finding</h2>
        <p className="thesis">{data.thesis}</p>
      </section>

      {suites.map((s) => (
        <SuiteCard key={s.id} s={s} />
      ))}

      <section className="panel">
        <div className="suite-head">
          <h2>{sk.title}</h2>
          <span className="gate-tag has-gate">+{sk.deltaPp}pp</span>
        </div>
        <p className="hint">{sk.note}</p>
        <div className="skeptic">
          <div className="sk-col">
            <div className="sk-num" style={{ color: 'var(--gray-700)' }}>{sk.baselinePct}%</div>
            <div className="muted">baseline</div>
          </div>
          <div className="sk-arrow">→</div>
          <div className="sk-col">
            <div className="sk-num" style={{ color: 'var(--green-700)' }}>{sk.skepticPct}%</div>
            <div className="muted">+ skeptic</div>
          </div>
          <div className="sk-facts">
            <div className="meta"><span>regressions</span><span className="mono">{sk.regressions}</span></div>
            <div className="meta"><span>significance</span><span className="mono">{sk.significance}</span></div>
          </div>
        </div>
      </section>

      <p className="hint src">{data.sources}</p>
    </div>
  );
}
