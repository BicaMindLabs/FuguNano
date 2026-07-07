import { useState } from 'react';

import { bridge } from '../bridge';
import { useT } from '../i18n';
import { buildRouteRoundCmd } from '../logic/command-builder';
import type { Candidate, SelectorDecision } from '../logic/selector';
import { outcomeColor, outcomeExit, routePreview } from '../logic/selector';

type Verified = 'unset' | 'pass' | 'fail';
interface Row {
  agent: string;
  verified: Verified;
  label: string;
}

const toCandidate = (r: Row): Candidate => ({
  agent: r.agent,
  ...(r.verified === 'unset' ? {} : { verified: r.verified === 'pass' }),
  ...(r.label.trim() === '' ? {} : { label: r.label.trim() }),
});

const defaultRows: Row[] = [
  { agent: 'mimo', verified: 'unset', label: 'A' },
  { agent: 'stepfun', verified: 'unset', label: 'A' },
  { agent: 'doubao', verified: 'unset', label: 'A' },
  { agent: 'deepseek', verified: 'unset', label: 'A' },
  { agent: 'minimax', verified: 'unset', label: 'B' },
];

// Confidence ring — an SVG gauge coloured by the outcome.
function Ring({ value, color }: { value: number; color: string }): JSX.Element {
  const r = 34;
  const c = 2 * Math.PI * r;
  const dash = Math.max(0, Math.min(1, value)) * c;
  return (
    <svg width="88" height="88" viewBox="0 0 88 88" className="ring" role="img" aria-label={`confidence ${Math.round(value * 100)}%`}>
      <circle cx="44" cy="44" r={r} fill="none" stroke="var(--gray-alpha-400)" strokeWidth="8" />
      <circle
        cx="44"
        cy="44"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${c}`}
        transform="rotate(-90 44 44)"
      />
      <text x="44" y="49" textAnchor="middle" className="ring-num">{`${Math.round(value * 100)}%`}</text>
    </svg>
  );
}

export function SelectorView(): JSX.Element {
  const { t } = useT();
  const [rows, setRows] = useState<Row[]>(defaultRows);
  const [category, setCategory] = useState('');
  const [round, setRound] = useState('');
  const [gate, setGate] = useState('');
  const [live, setLive] = useState<{ decision: SelectorDecision | null; raw: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const candidates = rows.filter((r) => r.agent.trim() !== '').map(toCandidate);
  const preview = routePreview(candidates, undefined, category.trim() === '' ? undefined : category.trim());
  const decision = live?.decision ?? preview;
  const color = outcomeColor(decision.outcome);

  const setRow = (i: number, patch: Partial<Row>): void =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const cycleVerified = (v: Verified): Verified =>
    v === 'unset' ? 'pass' : v === 'pass' ? 'fail' : 'unset';

  const runRound = (): void => {
    if (round.trim() === '') return;
    setBusy(true);
    const cmd = buildRouteRoundCmd(round.trim(), {
      gate,
      category: category.trim() === '' ? undefined : category.trim(),
    });
    void bridge.run(cmd).then((r) => {
      const jsonLine = r.stdout
        .split(/\r?\n/u)
        .map((l) => l.trim())
        .filter((l) => l.startsWith('{'))
        .pop();
      let d: SelectorDecision | null = null;
      if (jsonLine) {
        try {
          d = JSON.parse(jsonLine) as SelectorDecision;
        } catch {
          d = null;
        }
      }
      setLive({ decision: d, raw: r.stdout.trim() });
      setBusy(false);
    });
  };

  return (
    <div className="selector">
      <div className="col">
        <section className="panel">
          <h2>{t('selector.candidates')}</h2>
          <div className="cand-head">
            <span>{t('selector.agent')}</span>
            <span>{t('selector.gate')}</span>
            <span>{t('selector.answerLabel')}</span>
            <span />
          </div>
          {rows.map((r, i) => (
            <div className="cand-row" key={i}>
              <input
                className="input sm"
                value={r.agent}
                aria-label={`agent-${String(i)}`}
                onChange={(e) => setRow(i, { agent: e.target.value })}
              />
              <button
                className={`gatebtn gate-${r.verified}`}
                title={t('selector.gateToggle')}
                aria-label={`${t('selector.gateToggle')} — ${r.agent || `#${String(i + 1)}`}`}
                onClick={() => setRow(i, { verified: cycleVerified(r.verified) })}
              >
                {r.verified === 'pass' ? '✓' : r.verified === 'fail' ? '✗' : '·'}
              </button>
              <input
                className="input sm"
                value={r.label}
                aria-label={`label-${String(i)}`}
                onChange={(e) => setRow(i, { label: e.target.value })}
              />
              <button
                className="gatebtn"
                title={t('selector.removeCandidate')}
                aria-label={`${t('selector.removeCandidate')} — ${r.agent || `#${String(i + 1)}`}`}
                onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
              >
                −
              </button>
            </div>
          ))}
          <div className="steps" style={{ marginTop: 10 }}>
            <button
              className="btn btn-secondary"
              onClick={() => setRows((rs) => [...rs, { agent: '', verified: 'unset', label: '' }])}
            >
              {t('selector.addCandidate')}
            </button>
            <input
              className="input sm"
              style={{ maxWidth: 160 }}
              placeholder={t('selector.categoryPlaceholder')}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
          </div>
          <p className="hint">{t('selector.hint')}</p>
        </section>

        <section className="panel">
          <h2>{t('selector.orRoute')}</h2>
          <div className="goal-row">
            <input
              className="input sm"
              style={{ maxWidth: 120 }}
              placeholder={t('selector.roundN')}
              value={round}
              onChange={(e) => setRound(e.target.value)}
            />
            <input
              className="input sm"
              placeholder={t('selector.gateCmd')}
              value={gate}
              onChange={(e) => setGate(e.target.value)}
            />
            <button className="btn btn-primary" disabled={busy || round.trim() === ''} onClick={runRound}>
              {t('selector.route')}
            </button>
          </div>
          {live && (
            <button className="btn btn-secondary" style={{ marginTop: 8 }} onClick={() => setLive(null)}>
              {t('selector.backToPreview')}
            </button>
          )}
        </section>
      </div>

      <div className="col">
        <section className="panel verdict" style={{ borderColor: color }}>
          <div className="verdict-badge" style={{ background: color }}>
            {decision.outcome.replace(/_/g, ' ')}
          </div>
          <div className="verdict-body">
            <Ring value={decision.confidence} color={color} />
            <div className="verdict-meta">
              <div className="meta">
                <span>{t('selector.reason')}</span>
                <span className="mono">{decision.reason}</span>
              </div>
              <div className="meta">
                <span>{t('selector.pick')}</span>
                <span className="mono">{decision.pick ?? '—'}</span>
              </div>
              <div className="meta">
                <span>{t('selector.agreement')}</span>
                <span className="mono">{decision.agreementShare.toFixed(2)}</span>
              </div>
              <div className="meta">
                <span>{t('selector.exitCode')}</span>
                <span className="mono">{outcomeExit(decision.outcome)}</span>
              </div>
            </div>
          </div>
          <p className="reason-gloss">{t(`reason.${decision.reason}`)}</p>
          {live?.decision === null && <p className="hint">{t('selector.noJson')}</p>}
          {live && <pre className="raw">{live.raw}</pre>}
        </section>

        <section className="panel">
          <h2>{t('selector.verifierLadder')}</h2>
          <ol className="ladder">
            <li>{t('ladder.gate')} — <span className="muted">{t('ladder.gateNote')}</span></li>
            <li>{t('ladder.synth')} — <span className="muted">{t('ladder.synthNote')}</span></li>
            <li>{t('ladder.skeptic')} — <span className="muted">{t('ladder.skepticNote')}</span></li>
            <li>{t('ladder.judge')}</li>
            <li>{t('ladder.consensus')} — <span className="muted">{t('ladder.consensusNote')}</span></li>
            <li>{t('ladder.escalate')}</li>
          </ol>
        </section>
      </div>
    </div>
  );
}
