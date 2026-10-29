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
// Spec 2026-10-09 §12: what an uploaded Pilot logo may be. PNG or SVG, told apart by the
// bytes (never the name or the reported type); at most 256 KB; a PNG at most 2048×2048. An
// SVG is cleaned with DOMPurify under jsdom plus the spec's extra rules, and refused if
// cleaning would change anything beyond whitespace — the stored SVG is exactly what was
// checked, re-serialised without its prolog/comments and with an explicit width/height. The
// id is the sha256 of the stored bytes. jsdom loads on the first SVG (it is heavy) and is
// external to the server bundle (Dockerfile).
import { createHash } from 'node:crypto';
import createDOMPurify, { type DOMPurify } from 'dompurify';

export type LogoMime = 'image/svg+xml' | 'image/png';
export const MAX_LOGO_BYTES = 256 * 1024;
export const MAX_PNG_SIDE = 2048;
export const SVG_REFUSED = 'This SVG contains scripts or external references.';
export const NOT_AN_IMAGE = 'A logo must be a PNG or SVG image.';
export const TOO_LARGE = 'A logo must be at most 256 KB.';
export const PNG_TOO_LARGE = `A PNG logo must be at most ${MAX_PNG_SIDE} × ${MAX_PNG_SIDE} pixels.`;
export const SVG_NO_SIZE = 'This SVG has no size: give it a viewBox, or a width and height.';
export const SVG_UNREADABLE = 'This SVG could not be read.';

export interface CleanLogo { id: string; mime: LogoMime; data: Buffer; width: number; height: number }
export type CleanResult = { ok: true; logo: CleanLogo } | { ok: false; message: string };

const SVG_NS = 'http://www.w3.org/2000/svg';
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const LOCAL_REF = (v: string) => v.startsWith('#') || /^data:image\/png;base64,/i.test(v);
const EXTERNAL_URL = /url\(\s*['"]?(?!#)/i;

const refuse = (message: string): CleanResult => ({ ok: false, message });
const contentId = (data: Buffer) => `sha256:${createHash('sha256').update(data).digest('hex')}`;

export async function cleanLogo(bytes: Buffer): Promise<CleanResult> {
  if (bytes.length > MAX_LOGO_BYTES) return refuse(TOO_LARGE);
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_MAGIC)) return png(bytes);
  const text = svgText(bytes);
  return text === null ? refuse(NOT_AN_IMAGE) : svg(text);
}

function png(bytes: Buffer): CleanResult {
  if (bytes.length < 24 || bytes.toString('latin1', 12, 16) !== 'IHDR') return refuse(NOT_AN_IMAGE);
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width < 1 || height < 1) return refuse(NOT_AN_IMAGE);
  if (width > MAX_PNG_SIDE || height > MAX_PNG_SIDE) return refuse(PNG_TOO_LARGE);
  return { ok: true, logo: { id: contentId(bytes), mime: 'image/png', data: bytes, width, height } };
}

/** UTF-8 text starting (after an optional BOM and whitespace) with `<svg` or `<?xml`. */
function svgText(bytes: Buffer): string | null {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  const head = text.trimStart();
  return head.startsWith('<svg') || head.startsWith('<?xml') ? text : null;
}

interface Purifier { purify: DOMPurify; parse(text: string): Document; serialize(el: Element): string; touched: string[] }
let purifier: Promise<Purifier> | null = null;

function loadPurifier(): Promise<Purifier> {
  purifier ??= import('jsdom').then(({ JSDOM }) => {
    const { window } = new JSDOM('');
    const purify = createDOMPurify(window as unknown as Parameters<typeof createDOMPurify>[0]);
    const serializer = new window.XMLSerializer();
    const p: Purifier = {
      purify, touched: [],
      parse: (text) => new JSDOM(text, { contentType: 'image/svg+xml' }).window.document as unknown as Document,
      serialize: (el) => serializer.serializeToString(el as unknown as Parameters<typeof serializer.serializeToString>[0]),
    };
    // The spec's rules beyond DOMPurify's SVG profile. Every removal is recorded: any one refuses.
    purify.addHook('uponSanitizeAttribute', (_node, data) => {
      const name = data.attrName.toLowerCase();
      const value = data.attrValue.trim();
      const bad = ((name === 'href' || name === 'xlink:href') && !LOCAL_REF(value))
        || /javascript:/i.test(value)
        || (name === 'style' && EXTERNAL_URL.test(value));
      if (bad && data.keepAttr) {
        data.keepAttr = false;
        p.touched.push(`${data.attrName} attribute`);
      }
    });
    purify.addHook('uponSanitizeElement', (node, data) => {
      const css = node.textContent ?? '';
      if (data.tagName === 'style' && (/@import/i.test(css) || EXTERNAL_URL.test(css))) {
        node.parentNode?.removeChild(node);
        p.touched.push('style element');
      }
    });
    return p;
  });
  return purifier;
}

/** Structure only: element names and namespaces, sorted attributes, non-blank text. */
function canon(n: Node): string {
  if (n.nodeType === 3) {
    const t = (n as Text).data.replace(/\s+/g, ' ').trim();
    return t ? JSON.stringify(t) : '';
  }
  if (n.nodeType !== 1) return '';
  const el = n as Element;
  const attrs = [...el.attributes].map((a) => `${a.namespaceURI ?? ''}|${a.localName}=${a.value}`).sort().join(',');
  return `<${el.namespaceURI}|${el.localName} ${attrs}>${[...el.childNodes].map(canon).join('')}</>`;
}

function cdataSections(n: Node, out: CDATASection[] = []): CDATASection[] {
  for (const child of n.childNodes) {
    if (child.nodeType === 4) out.push(child as CDATASection);
    else cdataSections(child, out);
  }
  return out;
}

const NUMBER = /^\s*(\d+(?:\.\d+)?)(?:px)?\s*$/;

async function svg(text: string): Promise<CleanResult> {
  // Entity declarations can pull in outside content; no logo needs a DOCTYPE.
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) return refuse(SVG_REFUSED);
  const p = await loadPurifier();
  let root: Element | null;
  try {
    root = p.parse(text).documentElement;
  } catch {
    return refuse(SVG_UNREADABLE);
  }
  if (!root || root.namespaceURI !== SVG_NS || root.localName !== 'svg') return refuse(NOT_AN_IMAGE);
  // A CDATA section cannot enter the HTML document DOMPurify imports into (jsdom throws), so it
  // becomes the plain text it stands for — and then gets the same style/script checks (final review).
  for (const cdata of cdataSections(root)) cdata.replaceWith(cdata.ownerDocument.createTextNode(cdata.data));
  p.touched.length = 0;
  // A node, not a string: DOMPurify then checks attribute names case-insensitively, which keeps
  // viewBox (its XHTML parser mode drops it).
  const body = p.purify.sanitize(root, {
    USE_PROFILES: { svg: true, svgFilters: false }, FORBID_TAGS: ['foreignObject'], RETURN_DOM: true,
  });
  const out = (body as Element).firstElementChild;
  // DOMPurify records the <body> it wraps the import in; anything else it dropped is a change.
  const dropped = p.purify.removed.some((r) => !('element' in r && r.element?.nodeName === 'BODY'));
  if (!out || dropped || p.touched.length > 0 || canon(out) !== canon(root)) return refuse(SVG_REFUSED);
  const vb = (out.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  const hasViewBox = vb.length === 4 && vb.every(Number.isFinite) && vb[2]! > 0 && vb[3]! > 0;
  const w = NUMBER.exec(out.getAttribute('width') ?? '');
  const h = NUMBER.exec(out.getAttribute('height') ?? '');
  let width: number;
  let height: number;
  if (w && h) {
    width = Math.max(1, Math.round(Number(w[1])));
    height = Math.max(1, Math.round(Number(h[1])));
  } else if (hasViewBox) {
    width = Math.max(1, Math.round(vb[2]!));
    height = Math.max(1, Math.round(vb[3]!));
  } else {
    return refuse(SVG_NO_SIZE);
  }
  out.setAttribute('width', String(width));
  out.setAttribute('height', String(height));
  const data = Buffer.from(p.serialize(out), 'utf8');
  return { ok: true, logo: { id: contentId(data), mime: 'image/svg+xml', data, width, height } };
}
