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
import { resolveTheme, checkContrast, safeResolve, type PilotTheme } from './pilot-theme';

const AMBER_SITE: PilotTheme = { schema: 1, colors: { light: { brand: '#d97706' } } };

describe('safeResolve (spec §11 runtime fallback)', () => {
  it('a chain that passes is returned exactly as resolveTheme merges it', () => {
    const site: PilotTheme = { schema: 1, appTitle: 'Acme', font: 'lato' };
    const root: PilotTheme = { schema: 1, colors: { light: { brand: '#15803d' } } };
    const leaf: PilotTheme = { schema: 1, appTitle: 'Cell A' };
    expect(safeResolve(site, [root, leaf])).toEqual(resolveTheme([site, root, leaf]));
  });

  it('an override foreground that a later site change made unreadable goes back to automatic', () => {
    const wc: PilotTheme = { schema: 1, colors: { light: { accentFg: '#ffffff' } } };
    expect(checkContrast(resolveTheme([AMBER_SITE, wc])).failures.length).toBeGreaterThan(0);
    const t = safeResolve(AMBER_SITE, [wc]);
    expect(t.colors.light.accentFg).toBe('#0b1220');
    expect(t.colors.light.brand).toBe('#d97706');
    expect(checkContrast(t).failures).toEqual([]);
  });

  it('a failing colour with no auto rule reverts to the site value; the passing overrides stay', () => {
    const wc: PilotTheme = { schema: 1, appTitle: 'Line 3', colors: { light: { text: '#9ca3af', brand: '#15803d' } } };
    const t = safeResolve({ schema: 1 }, [wc]);
    expect(t.colors.light.text).toBeNull();
    expect(t.colors.light.brand).toBe('#15803d');
    expect(t.appTitle).toBe('Line 3');
    expect(checkContrast(t).failures).toEqual([]);
  });

  it('a failing work-center accent falls back to the site\'s', () => {
    expect(safeResolve({ schema: 1 }, [{ schema: 1, wcAccent: '#0f1b2d' }]).wcAccent).toBeNull();
    const t = safeResolve({ schema: 1, wcAccent: '#f59e0b' }, [{ schema: 1, wcAccent: '#0f1b2d' }]);
    expect(t.wcAccent).toBe('#f59e0b');
    expect(checkContrast(t).failures).toEqual([]);
  });

  it('a failing header text (and its muted derivative) goes back to automatic on the override header', () => {
    const wc: PilotTheme = { schema: 1, colors: { light: { headerBg: '#0f1b2d', headerFg: '#4b5563' } } };
    const t = safeResolve({ schema: 1 }, [wc]);
    expect(t.colors.light.headerBg).toBe('#0f1b2d');
    expect(t.colors.light.headerFg).toBe('#ffffff');
    expect(checkContrast(t).failures).toEqual([]);
  });

  it('an accent that fails on its panel drops the brand it follows', () => {
    const t = safeResolve({ schema: 1 }, [{ schema: 1, colors: { light: { brand: '#facc15' } } }]);
    expect(t.colors.light.brand).toBeNull();
    expect(checkContrast(t).failures).toEqual([]);
  });
});

describe('safeResolve when the site pins the failing automatic foreground (final review)', () => {
  it('auto-picks that foreground instead of dropping the whole work-center branding', () => {
    const site: PilotTheme = { schema: 1, colors: { light: { brand: '#1e3a8a', accentFg: '#ffffff' } } };
    const wc: PilotTheme = { schema: 1, appTitle: 'Line 3', font: 'lato', colors: { light: { brand: '#d97706' } } };
    expect(checkContrast(resolveTheme([site, wc])).failures.length).toBeGreaterThan(0);
    const t = safeResolve(site, [wc]);
    expect(t.appTitle).toBe('Line 3');
    expect(t.font).toBe('lato');
    expect(t.colors.light.brand).toBe('#d97706');
    expect(t.colors.light.accentFg).toBe('#0b1220');
    expect(checkContrast(t).failures).toEqual([]);
  });
});
