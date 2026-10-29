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
import {
  resolveTheme, checkContrast, contrastRows, describeFailure, describeWarning, CONTRAST_PAIRS, COLOR_KEYS,
  COLOR_LABELS, MODE_LABELS,
} from './pilot-theme';

describe('contrastRows (spec §9 contrast badges)', () => {
  it('lists every §11 pair for light then dark; the shipped defaults all pass', () => {
    const rows = contrastRows(resolveTheme([]));
    expect(rows).toHaveLength(CONTRAST_PAIRS.length * 2);
    expect(rows.slice(0, CONTRAST_PAIRS.length).every((r) => r.mode === 'light')).toBe(true);
    expect(rows.slice(CONTRAST_PAIRS.length).every((r) => r.mode === 'dark')).toBe(true);
    rows.slice(0, CONTRAST_PAIRS.length).forEach((r, i) => {
      expect([r.fg, r.bg, r.min]).toEqual([...CONTRAST_PAIRS[i]!]);
    });
    expect(rows.every((r) => r.pass)).toBe(true);
  });

  it('a failing row matches checkContrast exactly', () => {
    const t = resolveTheme([{ schema: 1, colors: { light: { text: '#9ca3af' } } }]);
    const failing = contrastRows(t).filter((r) => !r.pass).map(({ pass: _pass, ...f }) => f);
    expect(failing).toEqual(checkContrast(t).failures);
    expect(failing.length).toBeGreaterThan(0);
  });
});

describe('labels and messages', () => {
  it('every colour key and every pair member has a label', () => {
    for (const key of COLOR_KEYS) expect(COLOR_LABELS[key]).toBeTruthy();
    for (const [fg, bg] of CONTRAST_PAIRS) {
      expect(COLOR_LABELS[fg]).toBeTruthy();
      expect(COLOR_LABELS[bg]).toBeTruthy();
    }
    expect(new Set(Object.values(COLOR_LABELS)).size).toBe(Object.keys(COLOR_LABELS).length);
    expect(MODE_LABELS).toEqual({ light: 'Light', dark: 'Dark' });
  });

  it('describeFailure names the mode, both colours, the ratio and the minimum', () => {
    expect(describeFailure({ mode: 'light', fg: 'text', bg: 'surface', ratio: 2.5, min: 4.5 }))
      .toBe('Light mode: Text on Page background is 2.50:1 — needs 4.5:1');
    expect(describeFailure({ mode: 'dark', fg: 'focus', bg: 'headerBg', ratio: 1.97, min: 3 }))
      .toBe('Dark mode: Focus ring on Header background is 1.97:1 — needs 3:1');
  });

  it('describeWarning uses the spec wording', () => {
    expect(describeWarning({ mode: 'dark', field: 'brand', resembles: 'alarm' }))
      .toBe('Dark mode: Brand resembles a status colour (alarm)');
  });
});
