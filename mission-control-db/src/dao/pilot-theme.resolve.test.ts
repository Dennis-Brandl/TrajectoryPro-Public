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
import { contrast } from '../lib/color';
import {
  resolveTheme, effectiveColors, checkContrast, DEFAULT_COLORS, type PilotTheme,
} from './pilot-theme';

const LOGO_A = { id: `sha256:${'a'.repeat(64)}`, mime: 'image/png', alt: 'A' } as const;
const LOGO_B = { id: `sha256:${'b'.repeat(64)}`, mime: 'image/svg+xml', alt: 'B' } as const;

describe('resolveTheme (spec §8.2)', () => {
  it('no layers = shipped defaults, every colour null, nothing automatic', () => {
    const t = resolveTheme([]);
    expect(t).toMatchObject({
      appTitle: 'Mission Pilot', font: 'inter', density: 'comfortable', radius: 'md', defaultMode: 'light',
      logo: null, logoDark: null, wcAccent: null, auto: { light: [], dark: [] },
    });
    for (const mode of ['light', 'dark'] as const) {
      expect(Object.values(t.colors[mode]).every((v) => v === null)).toBe(true);
    }
  });

  it('later layers win field by field down a three-level chain', () => {
    const site: PilotTheme = { schema: 1, appTitle: 'Site', font: 'roboto', colors: { light: { brand: '#c2410c', text: '#0f172a' } } };
    const root: PilotTheme = { schema: 1, font: 'lato', density: 'touch', colors: { light: { brand: '#15803d' } } };
    const child: PilotTheme = { schema: 1, appTitle: 'Line 3', radius: 'none', font: null };
    const t = resolveTheme([site, root, child]);
    expect(t).toMatchObject({ appTitle: 'Line 3', font: 'lato', density: 'touch', radius: 'none' });
    expect(t.colors.light.brand).toBe('#15803d');
    expect(t.colors.light.text).toBe('#0f172a');
  });

  it('logo: false clears an inherited logo; a later layer can set one again; logoDark is replaced whole', () => {
    expect(resolveTheme([{ schema: 1, logo: LOGO_A }, { schema: 1, logo: false }]).logo).toBeNull();
    expect(resolveTheme([{ schema: 1, logo: LOGO_A }, { schema: 1, logo: false }, { schema: 1, logo: LOGO_B }]).logo).toEqual(LOGO_B);
    expect(resolveTheme([{ schema: 1, logo: LOGO_A }, { schema: 1, logo: null }]).logo).toEqual(LOGO_A);
    expect(resolveTheme([{ schema: 1, logoDark: LOGO_A }, { schema: 1, logoDark: LOGO_B }]).logoDark).toEqual(LOGO_B);
  });

  it('a themed brand gets an automatic accent foreground, recorded in auto', () => {
    const t = resolveTheme([{ schema: 1, colors: { light: { brand: '#facc15' } } }]);
    expect(t.colors.light.accentFg).toBe('#0b1220');
    expect(t.auto.light).toContain('accentFg');
    expect(t.colors.dark.accentFg).toBeNull(); // dark untouched
    expect(t.auto.dark).toEqual([]);
  });

  it('a themed header background gets an automatic header foreground', () => {
    const t = resolveTheme([{ schema: 1, colors: { light: { headerBg: '#f8fafc' } } }]);
    expect(t.colors.light.headerFg).toBe('#0b1220');
    expect(t.auto.light).toContain('headerFg');
  });

  it('an explicit foreground is never replaced', () => {
    const t = resolveTheme([{ schema: 1, colors: { light: { brand: '#facc15', accentFg: '#ffffff' } } }]);
    expect(t.colors.light.accentFg).toBe('#ffffff');
    expect(t.auto.light).not.toContain('accentFg');
  });

  it('focus is re-picked only when the shipped focus colour fails on the merged colours', () => {
    const fine = resolveTheme([{ schema: 1, colors: { light: { brand: '#7c3aed' } } }]);
    expect(fine.colors.light.focus).toBeNull();
    const clash = resolveTheme([{ schema: 1, colors: { light: { headerBg: '#2563eb' } } }]);
    expect(clash.colors.light.focus).toBe('#0b1220');
    expect(clash.auto.light).toContain('focus');
    const eff = effectiveColors(clash, 'light');
    expect(contrast(eff.focus, eff.surfaceRaised)).toBeGreaterThanOrEqual(3);
    expect(contrast(eff.focus, eff.headerBg)).toBeGreaterThanOrEqual(3);
  });
});

describe('effectiveColors', () => {
  it('fills shipped defaults, accent follows brand, header-accent and muted header text derive', () => {
    const light = effectiveColors(resolveTheme([]), 'light');
    expect(light.brand).toBe(DEFAULT_COLORS.light.brand);
    expect(light.accent).toBe(DEFAULT_COLORS.light.brand);
    expect(light.borderStrong).toBe('#848e9d');
    expect(light.wcAccent).toBe(light.headerAccent);
    const dark = effectiveColors(resolveTheme([]), 'dark');
    expect(dark.headerAccent).toBe(dark.brand);
    const themed = effectiveColors(resolveTheme([{ schema: 1, wcAccent: '#f59e0b', colors: { light: { brand: '#7c3aed' } } }]), 'light');
    expect(themed.accent).toBe('#7c3aed');
    expect(themed.wcAccent).toBe('#f59e0b');
  });
});

describe('checkContrast (spec §11)', () => {
  it('the shipped defaults pass in both modes, with no warnings', () => {
    expect(checkContrast(resolveTheme([]))).toEqual({ failures: [], warnings: [] });
  });

  it('reports each failing pair with its mode, a floored ratio and the minimum', () => {
    const r = checkContrast(resolveTheme([{ schema: 1, colors: { light: { brand: '#facc15', text: '#9ca3af' } } }]));
    expect(r.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ mode: 'light', fg: 'accent', bg: 'surfaceRaised', min: 3 }),
      expect.objectContaining({ mode: 'light', fg: 'text', bg: 'surface', min: 4.5 }),
      expect.objectContaining({ mode: 'light', fg: 'text', bg: 'surfaceRaised', min: 4.5 }),
    ]));
    expect(r.failures.some((f) => f.fg === 'accentFg')).toBe(false); // the auto foreground passes
    expect(r.failures.every((f) => f.mode === 'light')).toBe(true);
    for (const f of r.failures) {
      expect(f.ratio).toBeLessThan(f.min);
      expect(Number(f.ratio.toFixed(2))).toBe(f.ratio); // two decimals at most
    }
  });

  it('checks the work-center accent on the header in both modes', () => {
    const r = checkContrast(resolveTheme([{ schema: 1, wcAccent: '#0f1b2d' }]));
    expect(r.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ mode: 'light', fg: 'wcAccent', bg: 'headerBg' }),
      expect.objectContaining({ mode: 'dark', fg: 'wcAccent', bg: 'headerBg' }),
    ]));
  });

  it('warns when a themed brand resembles a status colour; never for greys or unset fields', () => {
    const red = checkContrast(resolveTheme([{ schema: 1, colors: { light: { brand: '#c81e1e' } } }]));
    expect(red.warnings).toEqual([{ mode: 'light', field: 'brand', resembles: 'alarm' }]);
    const grey = checkContrast(resolveTheme([{ schema: 1, colors: { light: { brand: '#475569' } } }]));
    expect(grey.warnings).toEqual([]);
  });
});

describe("a dark logo is a variant of its layer's logo (final review ruling)", () => {
  const LOGO_W = { id: `sha256:${'c'.repeat(64)}`, mime: 'image/png', alt: 'W' } as const;
  const site: PilotTheme = { schema: 1, logo: LOGO_A, logoDark: LOGO_B };

  it('a layer that sets its own logo, or the shipped mark, drops the dark logo it would inherit', () => {
    expect(resolveTheme([site, { schema: 1, logo: LOGO_W }])).toMatchObject({ logo: LOGO_W, logoDark: null });
    expect(resolveTheme([site, { schema: 1, logo: false }])).toMatchObject({ logo: null, logoDark: null });
  });

  it('a layer that sets both keeps both; a layer that sets only a dark logo keeps the inherited logo', () => {
    expect(resolveTheme([site, { schema: 1, logo: LOGO_W, logoDark: LOGO_A }])).toMatchObject({ logo: LOGO_W, logoDark: LOGO_A });
    expect(resolveTheme([site, { schema: 1, logoDark: LOGO_W }])).toMatchObject({ logo: LOGO_A, logoDark: LOGO_W });
  });

  it("a child that sets nothing inherits its parent's logo pair", () => {
    expect(resolveTheme([site, { schema: 1, logo: LOGO_W }, { schema: 1 }])).toMatchObject({ logo: LOGO_W, logoDark: null });
  });
});
