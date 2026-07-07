import { useEffect, useState } from 'react';

import { bridge } from '../bridge';
import { useT } from '../i18n';
import type { RoundSnapshot } from '../logic/round';
import { statusColor } from '../logic/round';

// Read-only monitor over the cache fan-out rounds on disk (round-<n>/).
export function RoundsView(): JSX.Element {
  const { t } = useT();
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
          <h2>{t('rounds.title')}</h2>
          <button className="gatebtn" title={t('rounds.refreshList')} aria-label={t('rounds.refreshList')} onClick={refreshList}>
            ↻
          </button>
        </div>
        {rounds.length === 0 ? (
          <div className="empty">{t('rounds.none')}</div>
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
          <div className="empty">{t('rounds.selectRound')}</div>
        ) : snap.error !== null ? (
          <div className="empty">round-{snap.round}: {snap.error}</div>
        ) : (
          <>
            <section className="panel">
              <div className="round-head">
                <h2>round-{snap.round}</h2>
                <button className="btn btn-secondary" onClick={refreshRound}>
                  {t('rounds.refresh')}
                </button>
              </div>
              {snap.totals && (
                <div className="totals">
                  <span className="tot"><b>{snap.totals.total}</b> {t('rounds.total')}</span>
                  <span className="tot" style={{ color: 'var(--green-700)' }}><b>{snap.totals.done}</b> {t('rounds.done')}</span>
                  <span className="tot" style={{ color: 'var(--red-800)' }}><b>{snap.totals.fail}</b> {t('rounds.fail')}</span>
                  <span className="tot" style={{ color: 'var(--gray-700)' }}><b>{snap.totals.pending}</b> {t('rounds.pending')}</span>
                </div>
              )}
            </section>

            <section className="panel grow">
              <h2>{t('rounds.agents')}</h2>
              <div className="grid">
                {snap.tasks.map((task) => (
                  <div className="cell" key={task.id}>
                    <div className="cell-head">
                      <span className="dot" style={{ background: statusColor(task.status) }} />
                      <span className="mono cell-agent">{task.agent}</span>
                      <span className="muted cell-status">{task.status}</span>
                    </div>
                    <div className="muted cell-id">{task.id} · {task.bytes}B</div>
                    {task.preview !== null && task.preview.trim() !== '' && (
                      <pre className="cell-preview">{task.preview}</pre>
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
