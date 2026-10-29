// Copyright 2026 Dennis L. Brandl
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { describe, it, expect } from 'vitest';
import { resolveTheme, themeCss, themePayload, parseTheme, LAYER_ORDER } from './pilot-theme';

describe('themeCss (spec §6.3)', () => {
  it('opens with the full layer-order statement, then a pilot.theme layer', () => {
    const css = themeCss(resolveTheme([]));
    expect(LAYER_ORDER).toBe('@layer pilot.defaults, pilot.theme, pilot.prefs, pilot.components;');
    expect(css.startsWith(`${LAYER_ORDER}\n@layer pilot.theme {`)).toBe(true);
  });

  it('an untouched theme sets font, density and radius to today\'s values and no colour', () => {
    const css = themeCss(resolveTheme([]));
    expect(css).toContain('--pilot-font-family: "Inter", system-ui, "Segoe UI", Roboto, sans-serif;');
    expect(css).toContain('--pilot-density-k: 1;');
    expect(css).toContain('--pilot-radius: .5rem;');
    expect(css).not.toContain('data-pilot-mode');
    expect(css).not.toMatch(/#[0-9a-f]{6}/);
  });

  it('light colours go in a light-mode block only; dark mode keeps its defaults', () => {
    const css = themeCss(resolveTheme([{ schema: 1, colors: { light: { brand: '#7c3aed' } } }]));
    expect(css).toContain(':root[data-pilot-mode="light"] {');
    expect(css).toContain('--pilot-brand: #7c3aed;');
    expect(css).toContain('--pilot-accent-fg: #ffffff;'); // the automatic foreground
    expect(css).not.toContain('data-pilot-mode="dark"');
  });

  it('maps font, density, radius and the work-center accent', () => {
    const css = themeCss(resolveTheme([{ schema: 1, font: 'system', density: 'compact', radius: 'none', wcAccent: '#f59e0b' }]));
    expect(css).toContain('--pilot-font-family: system-ui, "Segoe UI", Roboto, sans-serif;');
    expect(css).toContain('--pilot-density-k: 0.85;');
    expect(css).toContain('--pilot-radius: 0;');
    expect(css).toContain('--pilot-wc-accent: #f59e0b;');
  });

  it('nothing that failed parsing can reach the CSS', () => {
    const parsed = parseTheme({ schema: 1, colors: { light: { brand: 'red;}body{display:none' } } }, { strict: false });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const css = themeCss(resolveTheme([parsed.theme]));
    expect(css).not.toContain('body');
    expect(css).not.toContain('red');
  });

  it('every declaration is a --pilot-* custom property', () => {
    const css = themeCss(resolveTheme([{ schema: 1, wcAccent: '#f59e0b', colors: { light: { brand: '#7c3aed' }, dark: { headerBg: '#1e1b4b' } } }]));
    const decls = css.split('\n').filter((l) => l.includes(':') && !l.includes('{') && !l.startsWith('@'));
    expect(decls.length).toBeGreaterThan(0);
    for (const d of decls) expect(d.trim()).toMatch(/^--pilot-[a-z-]+: [^;{}]+;$/);
  });
});

describe('themePayload (spec §13)', () => {
  it('carries the rev, the resolved theme, its CSS, the font family and the header colours', () => {
    const t = resolveTheme([{ schema: 1, font: 'lato', colors: { dark: { headerBg: '#1e1b4b' } } }]);
    const p = themePayload(4, t);
    expect(p.rev).toBe(4);
    expect(p.theme).toBe(t);
    expect(p.css).toBe(themeCss(t));
    expect(p.fontFamily).toBe('Lato');
    expect(p.themeColor).toEqual({ light: '#0f1b2d', dark: '#1e1b4b' });
    expect(themePayload(0, resolveTheme([{ schema: 1, font: 'system' }])).fontFamily).toBeNull();
  });
});
