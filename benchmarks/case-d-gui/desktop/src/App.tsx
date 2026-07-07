import { useEffect, useState } from 'react';

import { useT } from './i18n';
import type { MsgKey } from './i18n';
import { BenchmarksView } from './views/BenchmarksView';
import { PipelineView } from './views/PipelineView';
import { RoundsView } from './views/RoundsView';
import { SelectorView } from './views/SelectorView';

type View = 'pipeline' | 'rounds' | 'selector' | 'benchmarks';

const NAV: { id: View; labelKey: MsgKey; glyph: string }[] = [
  { id: 'pipeline', labelKey: 'nav.pipeline', glyph: '▸' },
  { id: 'rounds', labelKey: 'nav.rounds', glyph: '▦' },
  { id: 'selector', labelKey: 'nav.selector', glyph: '◈' },
  { id: 'benchmarks', labelKey: 'nav.benchmarks', glyph: '▤' },
];

export function App(): JSX.Element {
  const { t, lang, setLang } = useT();
  const [view, setView] = useState<View>('pipeline');
  const [dark, setDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }, [dark]);

  const activeLabel = t(NAV.find((n) => n.id === view)?.labelKey ?? 'nav.pipeline');

  return (
    <div className="shell">
      <nav className="rail">
        <div className="brand" title={t('app.title')}>
          F
        </div>
        {NAV.map((n) => (
          <button
            key={n.id}
            className={`rail-btn ${view === n.id ? 'active' : ''}`}
            title={t(n.labelKey)}
            onClick={() => setView(n.id)}
          >
            <span className="rail-glyph">{n.glyph}</span>
            <span className="rail-label">{t(n.labelKey)}</span>
          </button>
        ))}
        <div className="rail-spacer" />
        <button
          className="rail-btn compact"
          title={t('app.toggleLang')}
          onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}
        >
          <span className="rail-glyph">{lang === 'en' ? 'EN' : '中'}</span>
          <span className="rail-label">{lang === 'en' ? '中文' : 'English'}</span>
        </button>
        <button className="rail-btn compact" title={t('app.toggleTheme')} onClick={() => setDark((d) => !d)}>
          <span className="rail-glyph">{dark ? '☀' : '☾'}</span>
          <span className="rail-label">{dark ? 'Light' : 'Dark'}</span>
        </button>
      </nav>

      <div className="content">
        <header className="topbar">
          <div className="topbar-title">
            <h1>{t('app.title')}</h1>
            <span className="topbar-sub">{t('app.subtitle')}</span>
          </div>
          <span className="phase">{activeLabel}</span>
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
