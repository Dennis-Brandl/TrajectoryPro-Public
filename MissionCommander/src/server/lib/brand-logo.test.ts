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
import { createHash } from 'node:crypto';
import {
  cleanLogo, SVG_REFUSED, NOT_AN_IMAGE, TOO_LARGE, PNG_TOO_LARGE, SVG_NO_SIZE, SVG_UNREADABLE, MAX_LOGO_BYTES,
} from './brand-logo';

const S = (s: string) => Buffer.from(s, 'utf8');
const NS = 'xmlns="http://www.w3.org/2000/svg"';
const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const sha = (b: Buffer) => `sha256:${createHash('sha256').update(b).digest('hex')}`;

async function refused(text: string) {
  const r = await cleanLogo(S(text));
  return r.ok ? 'accepted' : r.message;
}

describe('cleanLogo — PNG (spec 2026-10-09 §12)', () => {
  it('a PNG is stored as uploaded, with its size and the hash of its bytes', async () => {
    const r = await cleanLogo(PNG_1x1);
    expect(r).toEqual({ ok: true, logo: { id: sha(PNG_1x1), mime: 'image/png', data: PNG_1x1, width: 1, height: 1 } });
  });

  it('a PNG wider or taller than 2048 px is refused', async () => {
    const wide = Buffer.from(PNG_1x1);
    wide.writeUInt32BE(4096, 16);
    expect(await cleanLogo(wide)).toEqual({ ok: false, message: PNG_TOO_LARGE });
    expect(PNG_TOO_LARGE).toBe('A PNG logo must be at most 2048 × 2048 pixels.');
  });

  it('anything over 256 KB is refused before it is read', async () => {
    expect(await cleanLogo(Buffer.alloc(MAX_LOGO_BYTES + 1, 0x20))).toEqual({ ok: false, message: TOO_LARGE });
    expect(TOO_LARGE).toBe('A logo must be at most 256 KB.');
  });

  it('the type comes from the bytes: text, HTML and a JPEG header are not images', async () => {
    expect(await refused('hello')).toBe(NOT_AN_IMAGE);
    expect(await refused('<html/>')).toBe(NOT_AN_IMAGE);
    expect(await refused('<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"/>')).toBe(NOT_AN_IMAGE);
    expect(await cleanLogo(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]))).toEqual({ ok: false, message: NOT_AN_IMAGE });
    expect(NOT_AN_IMAGE).toBe('A logo must be a PNG or SVG image.');
  });
});

describe('cleanLogo — SVG (spec 2026-10-09 §12)', () => {
  it('a plain SVG (BOM, XML prolog, comment, whitespace) is accepted and gets an explicit size', async () => {
    const r = await cleanLogo(S(`﻿<?xml version="1.0" encoding="UTF-8"?>\n<!-- logo -->\n<svg ${NS} viewBox="0 0 100 40">\n  <rect width="100" height="40" fill="#1d4ed8"/>\n  <text x="10" y="25" fill='white'>Acme</text>\n</svg>`));
    if (!r.ok) throw new Error(r.message);
    expect(r.logo.mime).toBe('image/svg+xml');
    expect([r.logo.width, r.logo.height]).toEqual([100, 40]);
    const text = r.logo.data.toString('utf8');
    expect(text.startsWith('<svg')).toBe(true);
    expect(text).toContain('viewBox="0 0 100 40"');
    expect(text).toContain('width="100"');
    expect(text).toContain('height="40"');
    expect(text).toContain('>Acme</text>');
    expect(r.logo.id).toBe(sha(r.logo.data));
  });

  it('cleaning is stable: the stored bytes clean to themselves (same id)', async () => {
    const first = await cleanLogo(S(`<svg ${NS} viewBox="0 0 10 4"><path d="M0 0h10v4z"/></svg>`));
    if (!first.ok) throw new Error(first.message);
    const again = await cleanLogo(first.logo.data);
    expect(again.ok && again.logo.id).toBe(first.logo.id);
  });

  it('numeric width/height are kept; a percentage size is replaced from the viewBox', async () => {
    const px = await cleanLogo(S(`<svg ${NS} width="120px" height="48" viewBox="0 0 10 4"><path d="M0 0h10v4z"/></svg>`));
    expect(px.ok && [px.logo.width, px.logo.height]).toEqual([120, 48]);
    const pct = await cleanLogo(S(`<svg ${NS} width="100%" viewBox="0 0 30 20"><path d="M0 0h10v4z"/></svg>`));
    expect(pct.ok && [pct.logo.width, pct.logo.height]).toEqual([30, 20]);
    expect(pct.ok && pct.logo.data.toString()).toContain('width="30"');
  });

  it('an SVG with no viewBox and no size is refused', async () => {
    expect(await refused(`<svg ${NS}><path d="M0 0h10v4z"/></svg>`)).toBe(SVG_NO_SIZE);
  });

  it('local references survive: fragment urls in CSS and a data:image/png image', async () => {
    expect(await refused(`<svg ${NS} viewBox="0 0 10 10"><style>.a{fill:url(#g)}</style><rect class="a" width="10" height="10"/></svg>`)).toBe('accepted');
    expect(await refused(`<svg ${NS} viewBox="0 0 10 10"><image href="data:image/png;base64,iVBORw0KGgo=" width="10" height="10"/></svg>`)).toBe('accepted');
  });

  it.each([
    ['a script', `<svg ${NS} viewBox="0 0 10 10"><script>alert(1)</script></svg>`],
    ['an event handler', `<svg ${NS} viewBox="0 0 10 10" onload="alert(1)"><rect width="10" height="10"/></svg>`],
    ['foreignObject', `<svg ${NS} viewBox="0 0 10 10"><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject></svg>`],
    ['an external href', `<svg ${NS} viewBox="0 0 10 10"><image href="https://evil.example/x.png" width="10" height="10"/></svg>`],
    ['a javascript: link', `<svg ${NS} xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10"><a xlink:href="javascript:alert(1)"><rect width="10" height="10"/></a></svg>`],
    ['a style @import', `<svg ${NS} viewBox="0 0 10 10"><style>@import url(https://evil.example/a.css);</style><rect width="10" height="10"/></svg>`],
    ['an external url() in a style attribute', `<svg ${NS} viewBox="0 0 10 10"><rect style="fill:url(https://e.example/a)" width="10" height="10"/></svg>`],
    ['a DOCTYPE with entities', `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "y">]><svg ${NS} viewBox="0 0 1 1"/>`],
    ['editor metadata (Inkscape namespaces)', `<svg ${NS} xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" viewBox="0 0 10 10" inkscape:version="1.0"><rect width="10" height="10"/></svg>`],
  ])('an SVG with %s is refused, never stored altered', async (_what, text) => {
    expect(await refused(text)).toBe(SVG_REFUSED);
    expect(SVG_REFUSED).toBe('This SVG contains scripts or external references.');
  });

  it('CDATA in a <style> (common in design-tool exports) is checked like any style, never a 500 (final review)', async () => {
    expect(await refused(`<svg ${NS} viewBox="0 0 10 10"><style><![CDATA[.a{fill:red}]]></style><rect class="a" width="10" height="10"/></svg>`)).toBe('accepted');
    expect(await refused(`<svg ${NS} viewBox="0 0 10 10"><style><![CDATA[@import url(https://evil.example/a.css);]]></style><rect width="10" height="10"/></svg>`)).toBe(SVG_REFUSED);
    expect(await refused(`<svg ${NS} viewBox="0 0 10 10"><script><![CDATA[alert(1)]]></script></svg>`)).toBe(SVG_REFUSED);
  });

  it('malformed XML and an SVG with no SVG namespace are refused', async () => {
    expect(await refused(`<svg ${NS}><rect></svg>`)).toBe(SVG_UNREADABLE);
    expect(await refused('<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>')).toBe(NOT_AN_IMAGE);
  });
});
