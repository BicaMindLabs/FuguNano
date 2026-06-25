import { describe, expect, it } from 'vitest';

import { isGo, failures } from './gate.js';
import { checkProviderConfig } from './preflight-checks.js';

const severityOf = (text: string, name: string): string | undefined =>
  checkProviderConfig(text).checks.find((c) => c.name === name)?.severity;

describe('checkProviderConfig (bash parity)', () => {
  it('flags gemini/antigravity in a model= or url= value (case-insensitive) → NO-GO', () => {
    expect(severityOf('model = gemini-pro', 'no-gemini')).toBe('fail');
    expect(severityOf('url = https://api.antigravity.example/v1', 'no-gemini')).toBe('fail');
    expect(severityOf('model = GEMINI', 'no-gemini')).toBe('fail');
    expect(isGo(checkProviderConfig('model = gemini'))).toBe(false);
  });

  it('ignores gemini inside a comment line', () => {
    expect(severityOf('# model = gemini (disabled)', 'no-gemini')).toBe('ok');
    expect(severityOf('   # url = antigravity', 'no-gemini')).toBe('ok');
  });

  it('counts model lines and warns when there are none', () => {
    expect(severityOf('model = doubao\nmodel = glm', 'model-configured')).toBe('ok');
    expect(severityOf('url = https://x', 'model-configured')).toBe('warn');
  });

  it('fails on an empty model value (bare or quoted)', () => {
    expect(severityOf('model =', 'model-nonempty')).toBe('fail');
    expect(severityOf('model = ""', 'model-nonempty')).toBe('fail');
    expect(severityOf('model = doubao', 'model-nonempty')).toBe('ok');
  });

  it('a clean multi-agent config is GO', () => {
    const cfg = 'model = doubao\nmodel = glm\nurl = https://ark.example/v1';
    const result = checkProviderConfig(cfg);
    expect(failures(result)).toHaveLength(0);
    expect(isGo(result)).toBe(true);
  });
});
