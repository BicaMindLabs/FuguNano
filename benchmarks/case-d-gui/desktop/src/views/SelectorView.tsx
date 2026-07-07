import { useState } from 'react';

import { bridge } from '../bridge';
import { buildRouteRoundCmd } from '../logic/command-builder';
import type { Candidate, SelectorDecision } from '../logic/selector';
import { outcomeColor, outcomeExit, reasonLabel, routePreview } from '../logic/selector';

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
          <h2>Candidates</h2>
          <div className="cand-head">
            <span>agent</span>
            <span>gate</span>
            <span>answer label</span>
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
                title="unset → pass → fail"
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
              <button className="gatebtn" title="remove" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                −
              </button>
            </div>
          ))}
          <div className="steps" style={{ marginTop: 10 }}>
            <button
              className="btn btn-secondary"
              onClick={() => setRows((rs) => [...rs, { agent: '', verified: 'unset', label: '' }])}
            >
              + candidate
            </button>
            <input
              className="input sm"
              style={{ maxWidth: 160 }}
              placeholder="category (e.g. security)"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
          </div>
          <p className="hint">
            Set a gate result (✓/✗) to simulate a verifier; leave gates unset and use answer labels to
            simulate consensus. A live preview mirrors the engine's <span className="mono">route()</span>.
          </p>
        </section>

        <section className="panel">
          <h2>Or route a real fan-out round</h2>
          <div className="goal-row">
            <input
              className="input sm"
              style={{ maxWidth: 120 }}
              placeholder="round n"
              value={round}
              onChange={(e) => setRound(e.target.value)}
            />
            <input
              className="input sm"
              placeholder="gate cmd (optional, e.g. ./run-tests.sh)"
              value={gate}
              onChange={(e) => setGate(e.target.value)}
            />
            <button className="btn btn-primary" disabled={busy || round.trim() === ''} onClick={runRound}>
              Route
            </button>
          </div>
          {live && (
            <button className="btn btn-secondary" style={{ marginTop: 8 }} onClick={() => setLive(null)}>
              back to preview
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
                <span>reason</span>
                <span className="mono">{decision.reason}</span>
              </div>
              <div className="meta">
                <span>pick</span>
                <span className="mono">{decision.pick ?? '—'}</span>
              </div>
              <div className="meta">
                <span>agreement</span>
                <span className="mono">{decision.agreementShare.toFixed(2)}</span>
              </div>
              <div className="meta">
                <span>exit code</span>
                <span className="mono">{outcomeExit(decision.outcome)}</span>
              </div>
            </div>
          </div>
          <p className="reason-gloss">{reasonLabel(decision.reason)}</p>
          {live?.decision === null && <p className="hint">route emitted no JSON — showing raw output below.</p>}
          {live && <pre className="raw">{live.raw}</pre>}
        </section>

        <section className="panel">
          <h2>Verifier ladder</h2>
          <ol className="ladder">
            <li>executable gate — <span className="muted">the only clean TRUST</span></li>
            <li>synthesized gate — <span className="muted">property tests / static rules</span></li>
            <li>skeptic pre-pass — <span className="muted">category-level challenge</span></li>
            <li>model judge</li>
            <li>consensus — <span className="muted">cheap, fails correlated</span></li>
            <li>escalate to premium</li>
          </ol>
        </section>
      </div>
    </div>
  );
}
