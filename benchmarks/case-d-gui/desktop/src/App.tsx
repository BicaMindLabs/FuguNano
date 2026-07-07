import { useEffect, useState } from 'react';

import { BenchmarksView } from './views/BenchmarksView';
import { PipelineView } from './views/PipelineView';
import { RoundsView } from './views/RoundsView';
import { SelectorView } from './views/SelectorView';

type View = 'pipeline' | 'rounds' | 'selector' | 'benchmarks';

const NAV: { id: View; label: string; glyph: string }[] = [
  { id: 'pipeline', label: 'Pipeline', glyph: '▸' },
  { id: 'rounds', label: 'Rounds', glyph: '▦' },
  { id: 'selector', label: 'Selector', glyph: '◈' },
  { id: 'benchmarks', label: 'Benchmarks', glyph: '▤' },
];

export function App(): JSX.Element {
  const [view, setView] = useState<View>('pipeline');
  const [dark, setDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }, [dark]);

  return (
    <div className="shell">
      <nav className="rail">
        <div className="brand" title="FuguNano Studio">
          F
        </div>
        {NAV.map((n) => (
          <button
            key={n.id}
            className={`rail-btn ${view === n.id ? 'active' : ''}`}
            title={n.label}
            onClick={() => setView(n.id)}
          >
            <span className="rail-glyph">{n.glyph}</span>
            <span className="rail-label">{n.label}</span>
          </button>
        ))}
        <button className="rail-btn theme" title="toggle theme" onClick={() => setDark((d) => !d)}>
          <span className="rail-glyph">{dark ? '☀' : '☾'}</span>
        </button>
      </nav>

      <div className="content">
        <header className="topbar">
          <h1>FuguNano Studio</h1>
          <span className="phase">{NAV.find((n) => n.id === view)?.label}</span>
        </header>
        <div className="view">
          {view === 'pipeline' && <PipelineView />}
          {view === 'rounds' && <RoundsView />}
          {view === 'selector' && <SelectorView />}
          {view === 'benchmarks' && <BenchmarksView />}
        </div>
      </div>
    </div>
  );
}
