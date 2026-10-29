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
import { parseTheme, readTheme, fontStack, PILOT_FONTS, type PilotTheme } from './pilot-theme';

const LOGO = { id: `sha256:${'a'.repeat(64)}`, mime: 'image/png', alt: 'Acme' } as const;

function strict(raw: unknown) {
  return parseTheme(raw, { strict: true });
}

describe('parseTheme — strict (Commander writes, spec §7)', () => {
  it('accepts a full valid theme and lower-cases colours', () => {
    const raw = {
      schema: 1, appTitle: 'Acme Pilot', font: 'ibm-plex-sans', density: 'touch', radius: 'lg', defaultMode: 'system',
      logo: LOGO, logoDark: null, wcAccent: '#AABBCC',
      colors: { light: { brand: '#7C3AED', accent: null }, dark: { surface: '#000000' } },
    };
    const r = strict(raw);
    expect(r).toEqual({
      ok: true,
      theme: {
        schema: 1, appTitle: 'Acme Pilot', font: 'ibm-plex-sans', density: 'touch', radius: 'lg', defaultMode: 'system',
        logo: LOGO, logoDark: null, wcAccent: '#aabbcc',
        colors: { light: { brand: '#7c3aed', accent: null }, dark: { surface: '#000000' } },
      },
    });
  });

  it('accepts the empty theme and logo: false', () => {
    expect(strict({ schema: 1 })).toEqual({ ok: true, theme: { schema: 1 } });
    expect(strict({ schema: 1, logo: false })).toEqual({ ok: true, theme: { schema: 1, logo: false } });
  });

  it('requires an object with schema 1', () => {
    expect(strict(null)).toEqual({ ok: false, errors: ['theme must be a JSON object'] });
    expect(strict([])).toEqual({ ok: false, errors: ['theme must be a JSON object'] });
    expect(strict({})).toEqual({ ok: false, errors: ['schema must be 1'] });
    expect(strict({ schema: 2 })).toEqual({ ok: false, errors: ['schema must be 1'] });
  });

  it('rejects unknown fields at every level', () => {
    const r = strict({
      schema: 1, background: 'x', colors: { light: { brand: '#000000', glow: '#000000' }, sepia: {} },
      logo: { ...LOGO, href: 'x' },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toEqual(expect.arrayContaining([
      'background: unknown field', 'colors.sepia: unknown mode', 'colors.light.glow: unknown colour', 'logo.href: unknown field',
    ]));
  });

  it('every colour must be exactly #rrggbb — the style-injection defence', () => {
    for (const bad of ['#fff', 'red', '#1d4ed8;', '#1d4ed8}body{x', 'rgb(0,0,0)', '#1d4ed8ff', 12]) {
      const r = strict({ schema: 1, colors: { light: { brand: bad } } });
      expect(r, String(bad)).toEqual({ ok: false, errors: ['colors.light.brand: must be a #rrggbb colour'] });
      const w = strict({ schema: 1, wcAccent: bad });
      expect(w, String(bad)).toEqual({ ok: false, errors: ['wcAccent: must be a #rrggbb colour'] });
    }
  });

  it('enums: font, density, radius, defaultMode', () => {
    expect(strict({ schema: 1, font: 'comic-sans' })).toMatchObject({ ok: false });
    expect(strict({ schema: 1, font: 'toString' })).toMatchObject({ ok: false }); // own keys only
    expect(strict({ schema: 1, density: 'airy' })).toMatchObject({ ok: false });
    expect(strict({ schema: 1, radius: 'xl' })).toMatchObject({ ok: false });
    expect(strict({ schema: 1, defaultMode: 'auto' })).toMatchObject({ ok: false });
    for (const font of Object.keys(PILOT_FONTS)) expect(strict({ schema: 1, font })).toMatchObject({ ok: true });
  });

  it('appTitle: 1–40 characters after trimming, no control characters', () => {
    expect(strict({ schema: 1, appTitle: '  Acme  ' })).toEqual({ ok: true, theme: { schema: 1, appTitle: 'Acme' } });
    expect(strict({ schema: 1, appTitle: 'x'.repeat(40) })).toMatchObject({ ok: true });
    for (const bad of ['', '   ', 'x'.repeat(41), 'Acme\nPilot', 'Acme\u0007', 'Acme\u0085', 7]) {
      expect(strict({ schema: 1, appTitle: bad }), JSON.stringify(bad)).toMatchObject({ ok: false });
    }
  });

  it('logo: content-hash id, png or svg, alt up to 200 characters; logoDark may not be false', () => {
    expect(strict({ schema: 1, logo: { ...LOGO, id: 'sha256:abc' } })).toMatchObject({ ok: false });
    expect(strict({ schema: 1, logo: { ...LOGO, mime: 'image/gif' } })).toMatchObject({ ok: false });
    expect(strict({ schema: 1, logo: { ...LOGO, alt: 'x'.repeat(201) } })).toMatchObject({ ok: false });
    expect(strict({ schema: 1, logo: { ...LOGO, alt: '' } })).toMatchObject({ ok: true });
    expect(strict({ schema: 1, logoDark: false })).toMatchObject({ ok: false });
    expect(strict({ schema: 1, logoDark: LOGO })).toMatchObject({ ok: true });
  });

  it('null means inherit and is kept; undefined is dropped', () => {
    expect(strict({ schema: 1, font: null, appTitle: undefined })).toEqual({ ok: true, theme: { schema: 1, font: null } });
  });
});

describe('parseTheme — lax (the engine reads, spec §7)', () => {
  it('ignores unknown fields and drops each invalid field on its own', () => {
    const r = parseTheme({
      schema: 1, background: 'x', font: 'comic-sans', density: 'touch',
      colors: { light: { brand: 'red;}body{x', accent: '#00ff00', glow: '#000000' }, sepia: {} },
    }, { strict: false });
    expect(r).toEqual({ ok: true, theme: { schema: 1, density: 'touch', colors: { light: { accent: '#00ff00' } } } });
  });

  it('a non-object or a foreign schema reads as nothing set', () => {
    expect(parseTheme('x', { strict: false })).toEqual({ ok: true, theme: { schema: 1 } });
    expect(parseTheme({ schema: 9, font: 'lato' }, { strict: false })).toEqual({ ok: true, theme: { schema: 1 } });
  });
});

describe('readTheme', () => {
  it('parses stored JSON text leniently and never throws', () => {
    expect(readTheme(JSON.stringify({ schema: 1, font: 'lato' }))).toEqual({ schema: 1, font: 'lato' });
    expect(readTheme('{not json')).toEqual({ schema: 1 });
    expect(readTheme(null)).toEqual({ schema: 1 });
    expect(readTheme(undefined)).toEqual({ schema: 1 });
  });

  it('returns a fresh object each time (no shared mutable default)', () => {
    const a: PilotTheme = readTheme(null);
    a.font = 'lato';
    expect(readTheme(null)).toEqual({ schema: 1 });
  });
});

describe('fontStack (spec §10)', () => {
  it('names the family first, then the system stack; system is the stack alone', () => {
    expect(fontStack('inter')).toBe('"Inter", system-ui, "Segoe UI", Roboto, sans-serif');
    expect(fontStack('source-sans-3')).toBe('"Source Sans 3", system-ui, "Segoe UI", Roboto, sans-serif');
    expect(fontStack('system')).toBe('system-ui, "Segoe UI", Roboto, sans-serif');
  });

  it('offers exactly the eleven curated ids', () => {
    expect(Object.keys(PILOT_FONTS)).toEqual([
      'system', 'inter', 'ibm-plex-sans', 'source-sans-3', 'noto-sans', 'roboto', 'open-sans',
      'atkinson-hyperlegible', 'barlow', 'fira-sans', 'lato',
    ]);
  });
});
