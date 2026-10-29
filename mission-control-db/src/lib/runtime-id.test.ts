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
  DEFAULT_RUNTIME_ID_TEMPLATE, slugWorkCenterName, validateRuntimeIdTemplate,
  renderRuntimeId, runtimeIdBucket,
} from './runtime-id.js';
import fixtures from './runtime-id-fixtures.json' with { type: 'json' };

const AT = new Date('2026-10-07T14:35:09Z');
const TZ = 'UTC';
const WC = 'Mixing Line #1';

describe('slugWorkCenterName', () => {
  it('uppercases and collapses non-alphanumeric runs to a single dash', () => {
    expect(slugWorkCenterName('Mixing Line #1')).toBe('MIXING-LINE-1');
  });
  it('trims leading and trailing dashes', () => {
    expect(slugWorkCenterName('  --Blend--  ')).toBe('BLEND');
  });
  it('truncates to 24 characters and re-trims', () => {
    expect(slugWorkCenterName('A'.repeat(30))).toBe('A'.repeat(24));
    expect(slugWorkCenterName(`${'B'.repeat(24)} tail`)).toBe('B'.repeat(24));
  });
  it('falls back to WC when the name slugs to nothing', () => {
    expect(slugWorkCenterName('***')).toBe('WC');
  });
});

describe('renderRuntimeId', () => {
  it('renders every token', () => {
    const out = renderRuntimeId('{YYYY}|{YY}|{MM}|{DD}|{HH}|{mm}|{ss}|{WC}|{SEQ}',
      { now: AT, timeZone: TZ, workCenterName: WC, seq: 7 });
    expect(out).toBe('2026|26|10|07|14|35|09|MIXING-LINE-1|7');
  });
  it('pads {SEQ:n} to a minimum width, never truncating', () => {
    const ctx = { now: AT, timeZone: TZ, workCenterName: WC };
    expect(renderRuntimeId('X-{SEQ:3}', { ...ctx, seq: 7 })).toBe('X-007');
    expect(renderRuntimeId('X-{SEQ:3}', { ...ctx, seq: 1234 })).toBe('X-1234');
  });
  it('renders a null or blank template as the built-in default', () => {
    const ctx = { now: AT, timeZone: TZ, workCenterName: WC, seq: 42 };
    expect(renderRuntimeId(null, ctx)).toBe('RW-42');
    expect(renderRuntimeId('   ', ctx)).toBe('RW-42');
    expect(DEFAULT_RUNTIME_ID_TEMPLATE).toBe('RW-{SEQ}');
  });
  it('honours the timezone', () => {
    const ctx = { now: new Date('2026-10-07T23:30:00Z'), workCenterName: WC, seq: 1 };
    expect(renderRuntimeId('{YYYY}{MM}{DD}-{HH}', { ...ctx, timeZone: 'UTC' })).toBe('20261007-23');
    expect(renderRuntimeId('{YYYY}{MM}{DD}-{HH}', { ...ctx, timeZone: 'America/New_York' })).toBe('20261007-19');
    expect(renderRuntimeId('{YYYY}{MM}{DD}-{HH}', { ...ctx, timeZone: 'Asia/Tokyo' })).toBe('20261008-08');
  });
  it('renders midnight hour as 00, never 24', () => {
    const out = renderRuntimeId('{HH}', { now: new Date('2026-10-07T00:15:00Z'), timeZone: 'UTC', workCenterName: WC, seq: 1 });
    expect(out).toBe('00');
  });
});

describe('runtimeIdBucket', () => {
  const ctx = { now: AT, timeZone: TZ };
  it('concatenates only date and time tokens, in order of appearance', () => {
    expect(runtimeIdBucket('MIX-{YYYY}{MM}{DD}-{SEQ:3}', ctx)).toBe('20261007');
    expect(runtimeIdBucket('{YYYY}{MM}-{SEQ}', ctx)).toBe('202610');
    expect(runtimeIdBucket('{DD}/{MM}/{YYYY} {SEQ}', ctx)).toBe('07102026');
  });
  it('excludes {WC}, {SEQ} and literal text', () => {
    expect(runtimeIdBucket('PLANT-A/{WC}-{SEQ:4}', ctx)).toBe('');
  });
  it('is empty for a template with no date or time token, so the counter never restarts', () => {
    expect(runtimeIdBucket('RW-{SEQ}', ctx)).toBe('');
    expect(runtimeIdBucket(null, ctx)).toBe('');
  });
  it('changes when the date part rolls over and not before', () => {
    const t = 'MIX-{YYYY}{MM}{DD}-{SEQ:3}';
    const d = (iso: string) => runtimeIdBucket(t, { now: new Date(iso), timeZone: TZ });
    expect(d('2026-10-07T00:00:00Z')).toBe(d('2026-10-07T23:59:59Z'));
    expect(d('2026-10-07T23:59:59Z')).not.toBe(d('2026-10-08T00:00:00Z'));
  });
});

describe('validateRuntimeIdTemplate', () => {
  const opts = { workCenterName: WC };
  it('accepts a blank template (means the built-in default)', () => {
    expect(validateRuntimeIdTemplate('', opts).ok).toBe(true);
    expect(validateRuntimeIdTemplate('   ', opts).ok).toBe(true);
  });
  it('requires exactly one {SEQ}', () => {
    expect(validateRuntimeIdTemplate('MIX-{YYYY}', opts)).toMatchObject({ ok: false });
    expect(validateRuntimeIdTemplate('{SEQ}-{SEQ}', opts)).toMatchObject({ ok: false });
    expect(validateRuntimeIdTemplate('MIX-{SEQ}', opts).ok).toBe(true);
  });
  it('rejects an unknown token by name', () => {
    const r = validateRuntimeIdTemplate('{DDD}-{SEQ}', opts);
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toContain('{DDD}');
  });
  it('is case-sensitive: {MM} is month, {mm} is minute, {Month} is unknown', () => {
    expect(validateRuntimeIdTemplate('{MM}{mm}-{SEQ}', opts).ok).toBe(true);
    expect(validateRuntimeIdTemplate('{Month}-{SEQ}', opts).ok).toBe(false);
  });
  it('rejects a width on a non-SEQ token and an out-of-range SEQ width', () => {
    expect(validateRuntimeIdTemplate('{YYYY:2}-{SEQ}', opts).ok).toBe(false);
    expect(validateRuntimeIdTemplate('{SEQ:0}', opts).ok).toBe(false);
    expect(validateRuntimeIdTemplate('{SEQ:9}', opts).ok).toBe(true);
  });
  it('rejects literal characters outside the safe set, including a stray brace', () => {
    expect(validateRuntimeIdTemplate('MIX*{SEQ}', opts).ok).toBe(false);
    expect(validateRuntimeIdTemplate('MIX{-{SEQ}', opts).ok).toBe(false);
    expect(validateRuntimeIdTemplate('A-_./#:() {SEQ}', opts).ok).toBe(true);
  });
  it('rejects a template over 64 characters', () => {
    expect(validateRuntimeIdTemplate(`${'A'.repeat(60)}-{SEQ}`, opts).ok).toBe(false);
  });
  it('rejects a template whose rendered length would exceed 96', () => {
    const r = validateRuntimeIdTemplate('{WC}{WC}{WC}{WC}-{SEQ}', { workCenterName: 'X'.repeat(24) });
    expect(r.ok).toBe(false);
  });
  it('rejects {WC} and {SEQ} directly adjacent, in either order (rule 7)', () => {
    expect(validateRuntimeIdTemplate('{WC}{SEQ}', opts).ok).toBe(false);
    expect(validateRuntimeIdTemplate('{SEQ}{WC}', opts).ok).toBe(false);
  });
  it('accepts {WC} and {SEQ} once a separator is between them', () => {
    expect(validateRuntimeIdTemplate('{WC}-{SEQ}', opts).ok).toBe(true);
    expect(validateRuntimeIdTemplate('{WC}{YYYY}{SEQ}', opts).ok).toBe(true);
  });
  it('rejects a separator whose first character is a digit, in either order (rule 7, corrected)', () => {
    expect(validateRuntimeIdTemplate('{WC}1{SEQ}', opts).ok).toBe(false);
    expect(validateRuntimeIdTemplate('{SEQ}1{WC}', opts).ok).toBe(false);
    // A non-digit separator — even one character — is safe.
    expect(validateRuntimeIdTemplate('{WC}-{SEQ}', opts).ok).toBe(true);
  });
  it('regression: a WC rename can no longer collide labels via {WC}1{SEQ} (spec §5.3 rule 7, corrected)', () => {
    // An adjacency-only check lets this through: {WC}1{SEQ} with 'AB1' + seq 1 renders
    // 'AB1' + '1' + '1' = 'AB111', and after a rename to 'AB', seq 11 renders
    // 'AB' + '1' + '11' = 'AB111' too — identical label, same bucket. The template itself
    // must now be rejected for both names.
    expect(validateRuntimeIdTemplate('{WC}1{SEQ}', { workCenterName: 'AB1' }).ok).toBe(false);
    expect(validateRuntimeIdTemplate('{WC}1{SEQ}', { workCenterName: 'AB' }).ok).toBe(false);
    expect(renderRuntimeId('{WC}1{SEQ}', { now: AT, timeZone: TZ, workCenterName: 'AB1', seq: 1 }))
      .toBe(renderRuntimeId('{WC}1{SEQ}', { now: AT, timeZone: TZ, workCenterName: 'AB', seq: 11 }));
  });
  it('regression: a WC rename can no longer collide labels via {WC}{SEQ} (spec §5.3 rule 7)', () => {
    // Before rule 7: {WC}{SEQ} rendered 'AB1' + seq 1 = 'AB11', and after a rename to 'AB',
    // 'AB' + seq 11 = 'AB11' too — same work center, same bucket, identical label. The
    // template itself must now be rejected for both names, so that collision is unreachable.
    expect(validateRuntimeIdTemplate('{WC}{SEQ}', { workCenterName: 'AB1' }).ok).toBe(false);
    expect(validateRuntimeIdTemplate('{WC}{SEQ}', { workCenterName: 'AB' }).ok).toBe(false);
    // Sanity: confirm this is the real collision the rule closes off.
    expect(renderRuntimeId('{WC}{SEQ}', { now: AT, timeZone: TZ, workCenterName: 'AB1', seq: 1 }))
      .toBe(renderRuntimeId('{WC}{SEQ}', { now: AT, timeZone: TZ, workCenterName: 'AB', seq: 11 }));
  });
});

describe('shared fixture table', () => {
  it('renders every fixture exactly', () => {
    for (const f of fixtures.render) {
      expect(renderRuntimeId(f.template, {
        now: new Date(f.now), timeZone: f.timeZone, workCenterName: f.workCenterName, seq: f.seq,
      })).toBe(f.expected);
    }
  });
  it('validates every fixture exactly', () => {
    for (const f of fixtures.validate) {
      expect(validateRuntimeIdTemplate(f.template, { workCenterName: f.workCenterName }).ok).toBe(f.ok);
    }
  });
  it('buckets every fixture exactly', () => {
    for (const f of fixtures.bucket) {
      expect(runtimeIdBucket(f.template, { now: new Date(f.now), timeZone: f.timeZone })).toBe(f.expected);
    }
  });
});
