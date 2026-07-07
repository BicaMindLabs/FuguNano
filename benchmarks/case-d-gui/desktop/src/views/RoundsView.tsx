import { useEffect, useState } from 'react';

import { bridge } from '../bridge';
import type { RoundSnapshot } from '../logic/round';
import { statusColor } from '../logic/round';

// Read-only monitor over the cache fan-out rounds on disk (round-<n>/).
export function RoundsView(): JSX.Element {
  const [rounds, setRounds] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [snap, setSnap] = useState<RoundSnapshot | null>(null);

  const refreshList = (): void => {
    void bridge.listRounds().then((rs) => {
      setRounds(rs);
      setSelected((cur) => cur ?? rs[rs.length - 1] ?? null);
    });
  };
  useEffect(refreshList, []);

  useEffect(() => {
    if (selected === null) return;
    void bridge.round(selected).then(setSnap);
  }, [selected]);

  const refreshRound = (): void => {
    if (selected !== null) void bridge.round(selected).then(setSnap);
  };

  return (
    <div className="rounds">
      <aside className="round-list">
        <div className="round-list-head">
          <h2>Rounds</h2>
          <button className="gatebtn" title="refresh list" onClick={refreshList}>
            ↻
          </button>
        </div>
        {rounds.length === 0 ? (
          <div className="empty">No rounds in cache.</div>
        ) : (
          rounds.map((r) => (
            <button
              key={r}
              className={`round-pill ${selected === r ? 'active' : ''}`}
              onClick={() => setSelected(r)}
            >
              round-{r}
            </button>
          ))
        )}
      </aside>

      <main className="main">
        {snap === null ? (
          <div className="empty">Select a round.</div>
        ) : snap.error !== null ? (
          <div className="empty">round-{snap.round}: {snap.error}</div>
        ) : (
          <>
            <section className="panel">
              <div className="round-head">
                <h2>round-{snap.round}</h2>
                <button className="btn btn-secondary" onClick={refreshRound}>
                  Refresh
                </button>
              </div>
              {snap.totals && (
                <div className="totals">
                  <span className="tot"><b>{snap.totals.total}</b> total</span>
                  <span className="tot" style={{ color: 'var(--green-700)' }}><b>{snap.totals.done}</b> done</span>
                  <span className="tot" style={{ color: 'var(--red-800)' }}><b>{snap.totals.fail}</b> fail</span>
                  <span className="tot" style={{ color: 'var(--gray-700)' }}><b>{snap.totals.pending}</b> pending</span>
                </div>
              )}
            </section>

            <section className="panel grow">
              <h2>Agents</h2>
              <div className="grid">
                {snap.tasks.map((t) => (
                  <div className="cell" key={t.id}>
                    <div className="cell-head">
                      <span className="dot" style={{ background: statusColor(t.status) }} />
                      <span className="mono cell-agent">{t.agent}</span>
                      <span className="muted cell-status">{t.status}</span>
                    </div>
                    <div className="muted cell-id">{t.id} · {t.bytes}B</div>
                    {t.preview !== null && t.preview.trim() !== '' && (
                      <pre className="cell-preview">{t.preview}</pre>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
