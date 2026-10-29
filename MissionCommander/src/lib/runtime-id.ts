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

// Spec 2026-10-07 §9.3. MIRROR of mission-control-db/src/lib/runtime-id.ts — the Commander
// renderer imports only TYPES from that package (see lib/access-levels.ts, lib/action-server-origin.ts
// for the same pattern), so the formatter is copied rather than imported. The SERVER is the
// authority; this copy exists only to render the dialog preview and inline validation before
// the round trip. runtime-id.test.ts asserts both against the shared fixture table, so this
// file cannot drift. If you change one, change the other.

export const DEFAULT_RUNTIME_ID_TEMPLATE = 'RW-{SEQ}';

export const RUNTIME_ID_TOKENS = ['YYYY', 'YY', 'MM', 'DD', 'HH', 'mm', 'ss', 'WC', 'SEQ'] as const;
export type RuntimeIdToken = (typeof RUNTIME_ID_TOKENS)[number];

const DATE_TIME_TOKENS = new Set<string>(['YYYY', 'YY', 'MM', 'DD', 'HH', 'mm', 'ss']);
const LITERAL_RE = /^[A-Za-z0-9 \-_./#:()]*$/;
const MAX_TEMPLATE = 64;
const MAX_RENDERED = 96;
const WC_SLUG_MAX = 24;

// A FRESH regex per call: a module-level /g regex carries `lastIndex` between calls and
// would silently skip tokens on every second invocation.
const tokenRe = () => /\{([A-Za-z]+)(?::(\d))?\}/g;

export type TemplateCheck = { ok: true } | { ok: false; reason: string };

export function slugWorkCenterName(name: string): string {
  const trimmed = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, WC_SLUG_MAX)
    .replace(/^-+|-+$/g, '');
  return trimmed || 'WC';
}

type Parts = Record<'YYYY' | 'YY' | 'MM' | 'DD' | 'HH' | 'mm' | 'ss', string>;

function zonedParts(now: Date, timeZone: string): Parts {
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch {
    // An unknown zone must not break a run (§7). UTC is the documented fallback.
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC', hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  }
  const got: Record<string, string> = {};
  for (const p of fmt.formatToParts(now)) if (p.type !== 'literal') got[p.type] = p.value;
  // hour12:false yields the h24 cycle in some engines, where midnight is '24', not '00'.
  const hour = got.hour === '24' ? '00' : (got.hour ?? '00');
  const year = got.year ?? '0000';
  return {
    YYYY: year, YY: year.slice(-2),
    MM: got.month ?? '00', DD: got.day ?? '00',
    HH: hour, mm: got.minute ?? '00', ss: got.second ?? '00',
  };
}

/** The template with only its date/time tokens rendered, concatenated in order of
 *  appearance. The sequence restarts exactly when this string changes (§5.4). */
export function runtimeIdBucket(template: string | null, ctx: { now: Date; timeZone: string }): string {
  const tpl = (template ?? '').trim() || DEFAULT_RUNTIME_ID_TEMPLATE;
  const parts = zonedParts(ctx.now, ctx.timeZone);
  let out = '';
  for (const m of tpl.matchAll(tokenRe())) {
    const name = m[1]!;
    if (DATE_TIME_TOKENS.has(name)) out += parts[name as keyof Parts];
  }
  return out;
}

/** Never throws. A blank or null template renders the built-in default (§5.5). */
export function renderRuntimeId(
  template: string | null,
  ctx: { now: Date; timeZone: string; workCenterName: string; seq: number },
): string {
  const tpl = (template ?? '').trim() || DEFAULT_RUNTIME_ID_TEMPLATE;
  const parts = zonedParts(ctx.now, ctx.timeZone);
  const wc = slugWorkCenterName(ctx.workCenterName);
  return tpl.replace(tokenRe(), (whole, name: string, width: string | undefined) => {
    if (name === 'SEQ') {
      const s = String(ctx.seq);
      return width ? s.padStart(Number(width), '0') : s;
    }
    if (name === 'WC') return wc;
    if (DATE_TIME_TOKENS.has(name)) return parts[name as keyof Parts];
    return whole;
  });
}

export function validateRuntimeIdTemplate(
  template: string,
  opts: { workCenterName: string },
): TemplateCheck {
  const tpl = template.trim();
  if (tpl === '') return { ok: true };
  if (tpl.length > MAX_TEMPLATE) {
    return { ok: false, reason: `Format must be ${MAX_TEMPLATE} characters or fewer` };
  }

  let seqCount = 0;
  let literal = '';
  let cursor = 0;
  let prevName: string | null = null;
  for (const m of tpl.matchAll(tokenRe())) {
    const gap = tpl.slice(cursor, m.index);
    literal += gap;
    const name = m[1]!;
    const width = m[2];
    if (!(RUNTIME_ID_TOKENS as readonly string[]).includes(name)) {
      return { ok: false, reason: `Unknown token {${name}}` };
    }
    // Rule 7 (spec §5.3, corrected 2026-10-08 after the whole-branch review): {WC} and {SEQ}
    // are the only two variable-width tokens. Placed directly adjacent (in either order), a
    // work-center rename can shift the boundary between them and reproduce an earlier label
    // (e.g. {WC}{SEQ}: 'AB1'+1 and 'AB'+11 both render 'AB11'). An adjacency-only check is not
    // enough: a separator whose first character is a digit has the same hole — {WC}1{SEQ}
    // with 'AB1'+seq 1 renders 'AB1'+'1'+'1' = 'AB111', and after a rename to 'AB', seq 11
    // renders 'AB'+'1'+'11' = 'AB111' too. Only a separator that is empty OR starts with a
    // digit is unsafe; any other non-digit-leading separator is safe. That collides on the
    // runtime-label unique index at INSERT, where §7's render-time fallback cannot help — the
    // allocator's §6.2 probe is the only backstop for the digit-leading-separator case.
    if (
      prevName !== null &&
      ((prevName === 'WC' && name === 'SEQ') || (prevName === 'SEQ' && name === 'WC')) &&
      (gap === '' || /^[0-9]/.test(gap))
    ) {
      return { ok: false, reason: '{WC} and {SEQ} must be separated by a character that is not a digit' };
    }
    cursor = m.index + m[0].length;
    prevName = name;
    if (name === 'SEQ') {
      seqCount += 1;
      if (width !== undefined && (Number(width) < 1 || Number(width) > 9)) {
        return { ok: false, reason: '{SEQ:n} width must be between 1 and 9' };
      }
    } else if (width !== undefined) {
      return { ok: false, reason: `{${name}} does not take a width` };
    }
  }
  literal += tpl.slice(cursor);

  if (seqCount === 0) {
    return { ok: false, reason: 'Format must contain {SEQ} — it is what keeps IDs unique' };
  }
  if (seqCount > 1) return { ok: false, reason: 'Format must contain {SEQ} exactly once' };
  if (!LITERAL_RE.test(literal)) {
    return { ok: false, reason: 'Text may use letters, digits, space and - _ . / # : ( ) only' };
  }

  const sample = renderRuntimeId(tpl, {
    now: new Date(), timeZone: 'UTC', workCenterName: opts.workCenterName, seq: 999999,
  });
  if (sample.length > MAX_RENDERED) {
    return { ok: false, reason: `Format renders ${sample.length} characters; the limit is ${MAX_RENDERED}` };
  }
  return { ok: true };
}
