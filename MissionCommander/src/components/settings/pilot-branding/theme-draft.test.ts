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
import { resolveTheme, type PilotTheme } from 'mission-control-db/src/dao/pilot-theme';
import { withField, withColor, colorProvenance, fieldProvenance, parseHexInput } from './theme-draft';

describe('theme draft helpers', () => {
  it('withColor sets a lower-cased colour, and null removes the key, the empty mode and the empty colours', () => {
    const a = withColor({ schema: 1 }, 'light', 'brand', '#7C3AED');
    expect(a).toEqual({ schema: 1, colors: { light: { brand: '#7c3aed' } } });
    const b = withColor(withColor(a, 'dark', 'text', '#e5e9f0'), 'light', 'brand', null);
    expect(b).toEqual({ schema: 1, colors: { dark: { text: '#e5e9f0' } } });
    expect(withColor(b, 'dark', 'text', null)).toEqual({ schema: 1 });
  });

  it('withColor never mutates the draft it was given', () => {
    const draft: PilotTheme = { schema: 1, colors: { light: { brand: '#7c3aed' } } };
    withColor(draft, 'light', 'brand', null);
    expect(draft).toEqual({ schema: 1, colors: { light: { brand: '#7c3aed' } } });
  });

  it('withField sets a value and null removes the key', () => {
    const a = withField({ schema: 1 }, 'font', 'lato');
    expect(a).toEqual({ schema: 1, font: 'lato' });
    expect(withField(a, 'font', null)).toEqual({ schema: 1 });
    expect(withField({ schema: 1, appTitle: null }, 'appTitle', null)).toEqual({ schema: 1 });
  });

  it('provenance: site when the draft sets it, automatic when filled in for contrast, else default', () => {
    const draft: PilotTheme = { schema: 1, font: 'lato', colors: { light: { brand: '#facc15' } } };
    const resolved = resolveTheme([draft]);
    expect(colorProvenance(draft, resolved, 'light', 'brand')).toBe('site');
    expect(colorProvenance(draft, resolved, 'light', 'accentFg')).toBe('automatic for contrast');
    expect(colorProvenance(draft, resolved, 'dark', 'brand')).toBe('default');
    expect(fieldProvenance(draft, 'font')).toBe('site');
    expect(fieldProvenance(draft, 'density')).toBe('default');
  });

  it('parseHexInput: empty = inherit, # optional, upper case folded, anything else refused', () => {
    expect(parseHexInput('')).toEqual({ ok: true, value: null });
    expect(parseHexInput('  ')).toEqual({ ok: true, value: null });
    expect(parseHexInput('#7C3AED')).toEqual({ ok: true, value: '#7c3aed' });
    expect(parseHexInput('7c3aed')).toEqual({ ok: true, value: '#7c3aed' });
    for (const bad of ['#7c3', 'red', '#7c3aed;', '#7c3aedff', '##7c3aed']) expect(parseHexInput(bad)).toEqual({ ok: false });
  });

  it('provenance through base layers: the nearest layer that sets a field names it', () => {
    const base = [
      { label: 'site', theme: { schema: 1, font: 'lato' } as PilotTheme },
      { label: 'inherited from Plant', theme: { schema: 1, colors: { light: { brand: '#d97706' } } } as PilotTheme },
      { label: 'inherited from Line 3', theme: { schema: 1, colors: { light: { brand: '#15803d' } } } as PilotTheme },
    ];
    const draft: PilotTheme = { schema: 1, appTitle: 'Cell A' };
    const resolved = resolveTheme([...base.map((b) => b.theme), draft]);
    expect(colorProvenance(draft, resolved, 'light', 'brand', base, 'this work center')).toBe('inherited from Line 3');
    expect(colorProvenance(draft, resolved, 'light', 'accentFg', base, 'this work center')).toBe('automatic for contrast');
    expect(colorProvenance(draft, resolved, 'dark', 'brand', base, 'this work center')).toBe('default');
    expect(fieldProvenance(draft, 'font', base, 'this work center')).toBe('site');
    expect(fieldProvenance(draft, 'appTitle', base, 'this work center')).toBe('this work center');
    expect(fieldProvenance(draft, 'density', base, 'this work center')).toBe('default');
  });
});

describe('logo slots (spec 2026-10-09 §7: false = explicitly no logo)', () => {
  const A = { id: `sha256:${'a'.repeat(64)}`, mime: 'image/png' as const, alt: 'Acme' };

  it('withField sets a logo, keeps false, and deletes on null', () => {
    expect(withField({ schema: 1 }, 'logo', A)).toEqual({ schema: 1, logo: A });
    expect(withField({ schema: 1 }, 'logo', false)).toEqual({ schema: 1, logo: false });
    expect(withField({ schema: 1, logo: A }, 'logo', null)).toEqual({ schema: 1 });
    expect(withField({ schema: 1 }, 'logoDark', A)).toEqual({ schema: 1, logoDark: A });
  });

  it('fieldProvenance: a logo or false is this layer\'s; absent falls through to the base', () => {
    const base = [{ label: 'site', theme: { schema: 1 as const, logo: A } }];
    expect(fieldProvenance({ schema: 1, logo: false }, 'logo', base, 'this work center')).toBe('this work center');
    expect(fieldProvenance({ schema: 1 }, 'logo', base, 'this work center')).toBe('site');
    expect(fieldProvenance({ schema: 1 }, 'logoDark', base, 'this work center')).toBe('default');
  });
});
