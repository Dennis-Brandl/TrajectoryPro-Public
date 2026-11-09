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

import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import {
  describeRecurrence,
  nextOccurrence,
  parseRecurrence,
  previousOccurrence,
  slotsBetween,
  type Recurrence,
  type Slot,
} from './recurrence.js';

const ZONE = 'America/Chicago';
const d = (iso: string) => new Date(iso);

function rec(input: unknown): Recurrence {
  const p = parseRecurrence(input);
  if (!p.ok) throw new Error(p.problems.join('; '));
  return p.value;
}

/** Repeated nextOccurrence from `after`, up to `count` slots. */
function run(r: Recurrence, after: string, count: number): Slot[] {
  const out: Slot[] = [];
  let cur = d(after);
  for (let i = 0; i < count; i++) {
    const s = nextOccurrence(r, ZONE, cur);
    if (!s) break;
    out.push(s);
    cur = s.at;
  }
  return out;
}
const utc = (ss: Slot[]) => ss.map((s) => s.at.toISOString().replace('.000Z', 'Z').replace(':00Z', 'Z'));
const local = (ss: Slot[]) => ss.map((s) => DateTime.fromJSDate(s.at, { zone: ZONE }).toFormat('yyyy-MM-dd'));
const localTime = (ss: Slot[]) => ss.map((s) => DateTime.fromJSDate(s.at, { zone: ZONE }).toFormat('yyyy-MM-dd HH:mm'));

const weekly = (range: object) => ({
  type: 'weekly', every: 2, days: ['mon', 'thu'], times: ['06:00'], range,
});
const lastFriday = {
  type: 'monthly', every: 1, ordinal: 'last', weekday: 'fri', times: ['18:00'],
  range: { startDate: '2026-11-01', endAfter: 6 },
};

describe('nextOccurrence', () => {
  it('every 4 hours from Nov 9 06:00', () => {
    const r = rec({ type: 'interval', every: 4, unit: 'hours', startAt: '2026-11-09T06:00' });
    const s = run(r, '2026-11-08T00:00:00Z', 3);
    expect(utc(s)).toEqual(['2026-11-09T12:00Z', '2026-11-09T16:00Z', '2026-11-09T20:00Z']);
    expect(s.map((x) => x.number)).toEqual([1, 2, 3]);
  });

  it('weekdays at three shift starts', () => {
    const r = rec({
      type: 'daily', weekdaysOnly: true, times: ['06:00', '14:00', '22:00'],
      range: { startDate: '2026-11-09', noEnd: true },
    });
    expect(utc(run(r, '2026-11-08T00:00:00Z', 4))).toEqual([
      '2026-11-09T12:00Z', '2026-11-09T20:00Z', '2026-11-10T04:00Z', '2026-11-10T12:00Z',
    ]);
  });

  it('weekdays skip the weekend', () => {
    const r = rec({
      type: 'daily', weekdaysOnly: true, times: ['06:00'],
      range: { startDate: '2026-11-09', noEnd: true },
    });
    expect(local(run(r, '2026-11-13T18:00:00Z', 2))).toEqual(['2026-11-16', '2026-11-17']);
  });

  it('every 2 weeks, mon+thu', () => {
    const r = rec(weekly({ startDate: '2026-11-09', noEnd: true }));
    expect(local(run(r, '2026-11-08T00:00:00Z', 5))).toEqual([
      '2026-11-09', '2026-11-12', '2026-11-23', '2026-11-26', '2026-12-07',
    ]);
  });

  it('weekly with a mid-week startDate skips earlier days of that week', () => {
    const r = rec(weekly({ startDate: '2026-11-11', noEnd: true }));
    expect(local(run(r, '2026-11-08T00:00:00Z', 2))).toEqual(['2026-11-12', '2026-11-23']);
  });

  it('last Friday of the month, six times, then null', () => {
    const r = rec(lastFriday);
    const s = run(r, '2026-10-01T00:00:00Z', 10);
    expect(local(s)).toEqual([
      '2026-11-27', '2026-12-25', '2027-01-29', '2027-02-26', '2027-03-26', '2027-04-30',
    ]);
    expect(nextOccurrence(r, ZONE, s[5]!.at)).toBeNull();
  });

  it('slot numbers do not depend on where the search starts', () => {
    const s = nextOccurrence(rec(lastFriday), ZONE, d('2026-12-01T00:00:00Z'));
    expect(local([s!])).toEqual(['2026-12-25']);
    expect(s!.number).toBe(2);
  });

  it('day 31 falls on the last day of short months', () => {
    const r = rec({
      type: 'monthly', every: 1, dayOfMonth: 31, times: ['08:00'],
      range: { startDate: '2027-01-01', noEnd: true },
    });
    expect(local(run(r, '2026-12-31T00:00:00Z', 3))).toEqual(['2027-01-31', '2027-02-28', '2027-03-31']);
  });

  it('yearly first Monday of November', () => {
    const r = rec({
      type: 'yearly', every: 1, month: 11, ordinal: 'first', weekday: 'mon', times: ['07:00'],
      range: { startDate: '2026-11-01', noEnd: true },
    });
    expect(local(run(r, '2026-11-08T00:00:00Z', 2))).toEqual(['2027-11-01', '2028-11-06']);
  });

  it('yearly Feb 29 falls on Feb 28 in other years', () => {
    const r = rec({
      type: 'yearly', every: 1, month: 2, dayOfMonth: 29, times: ['08:00'],
      range: { startDate: '2027-01-01', noEnd: true },
    });
    expect(local(run(r, '2027-01-01T00:00:00Z', 2))).toEqual(['2027-02-28', '2028-02-29']);
  });

  it('once fires once, then null', () => {
    const r = rec({ type: 'once', at: '2026-11-10T09:30' });
    const s = run(r, '2026-11-08T00:00:00Z', 3);
    expect(utc(s)).toEqual(['2026-11-10T15:30Z']);
    expect(nextOccurrence(r, ZONE, d('2026-11-10T15:30:00Z'))).toBeNull();
  });

  it('is strictly after', () => {
    const r = rec({ type: 'interval', every: 1, unit: 'hours', startAt: '2026-11-09T06:00' });
    expect(nextOccurrence(r, ZONE, d('2026-11-09T12:00:00Z'))!.at.toISOString()).toBe('2026-11-09T13:00:00.000Z');
  });

  it('a daily time in the spring-forward gap fires at the gap end', () => {
    const r = rec({ type: 'daily', every: 1, times: ['02:30'], range: { startDate: '2027-03-01', noEnd: true } });
    const s = nextOccurrence(r, ZONE, d('2027-03-13T12:00:00Z'))!;
    expect(s.at.toISOString()).toBe('2027-03-14T08:00:00.000Z'); // 03:00 CDT
    expect(localTime([s])).toEqual(['2027-03-14 03:00']);
  });

  it('a daily time repeated by clocks going back fires only the first time', () => {
    const r = rec({ type: 'daily', every: 1, times: ['01:30'], range: { startDate: '2027-11-01', noEnd: true } });
    const s = run(r, '2027-11-06T12:00:00Z', 2);
    expect(utc(s)).toEqual(['2027-11-07T06:30Z', '2027-11-08T07:30Z']);
  });

  it('every 1 hour keeps 60 minutes across the clock change', () => {
    const r = rec({ type: 'interval', every: 1, unit: 'hours', startAt: '2027-03-13T00:00' });
    const s = run(r, '2027-03-13T12:00:00Z', 30);
    for (let i = 1; i < s.length; i++) {
      expect(s[i]!.at.getTime() - s[i - 1]!.at.getTime()).toBe(3_600_000);
    }
  });

  it.each([
    ['last weekday', { ordinal: 'last', weekday: 'weekday' }, '2026-11-30'],
    ['first weekendDay', { ordinal: 'first', weekday: 'weekendDay' }, '2026-11-01'],
    ['second day', { ordinal: 'second', weekday: 'day' }, '2026-11-02'],
  ])('monthly %s in Nov 2026', (_n, rule, expected) => {
    const r = rec({
      type: 'monthly', every: 1, times: ['09:00'], range: { startDate: '2026-11-01', noEnd: true }, ...rule,
    });
    expect(local(run(r, '2026-10-31T00:00:00Z', 1))).toEqual([expected]);
  });

  it('endBy is inclusive', () => {
    const r = rec({
      type: 'daily', every: 1, times: ['06:00'], range: { startDate: '2026-11-09', endBy: '2026-11-10' },
    });
    expect(local(run(r, '2026-11-08T00:00:00Z', 5))).toEqual(['2026-11-09', '2026-11-10']);
  });

  it('interval honours endAfter', () => {
    const r = rec({
      type: 'interval', every: 30, unit: 'minutes', startAt: '2026-11-09T06:00', range: { endAfter: 2 },
    });
    expect(run(r, '2026-11-08T00:00:00Z', 5)).toHaveLength(2);
  });
});

describe('parseRecurrence', () => {
  const daily = { type: 'daily', every: 1, times: ['06:00'], range: { startDate: '2026-11-09', noEnd: true } };
  it('accepts a valid pattern', () => {
    expect(parseRecurrence(daily).ok).toBe(true);
  });
  it.each([
    ['interval under 1 minute', { type: 'interval', every: 0, unit: 'minutes', startAt: '2026-11-09T06:00' }],
    ['fractional interval', { type: 'interval', every: 0.5, unit: 'minutes', startAt: '2026-11-09T06:00' }],
    ['interval with startDate', {
      type: 'interval', every: 1, unit: 'hours', startAt: '2026-11-09T06:00',
      range: { startDate: '2026-11-09', noEnd: true },
    }],
    ['once with range', { type: 'once', at: '2026-11-10T09:30', range: { noEnd: true } }],
    ['daily missing range', { type: 'daily', every: 1, times: ['06:00'] }],
    ['empty days', { ...weekly({ startDate: '2026-11-09', noEnd: true }), days: [] }],
    ['empty times', { ...daily, times: [] }],
    ['25:00', { ...daily, times: ['25:00'] }],
    ['two range ends', { ...daily, range: { startDate: '2026-11-09', noEnd: true, endAfter: 3 } }],
    ['daily with neither every nor weekdaysOnly', { ...daily, every: undefined }],
    ['unknown type', { type: 'hourly' }],
  ])('rejects %s', (_n, input) => {
    const p = parseRecurrence(input);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.problems.length).toBeGreaterThan(0);
  });
});

describe('parseRecurrence every caps', () => {
  const range = { startDate: '2026-11-09', noEnd: true };
  const cal = (type: string, every: number) =>
    type === 'weekly'
      ? { type, every, days: ['mon'], times: ['06:00'], range }
      : type === 'yearly'
        ? { type, every, month: 1, dayOfMonth: 1, times: ['06:00'], range }
        : type === 'monthly'
          ? { type, every, dayOfMonth: 1, times: ['06:00'], range }
          : { type, every, times: ['06:00'], range };
  it.each(['daily', 'weekly', 'monthly', 'yearly'])('%s allows 1000 and rejects 1001', (type) => {
    expect(parseRecurrence(cal(type, 1000)).ok).toBe(true);
    expect(parseRecurrence(cal(type, 1001)).ok).toBe(false);
  });
  it('interval allows a year of minutes or hours and rejects more', () => {
    const iv = (every: number, unit: string) => ({ type: 'interval', every, unit, startAt: '2026-11-09T06:00' });
    expect(parseRecurrence(iv(525_600, 'minutes')).ok).toBe(true);
    expect(parseRecurrence(iv(525_601, 'minutes')).ok).toBe(false);
    expect(parseRecurrence(iv(8760, 'hours')).ok).toBe(true);
    expect(parseRecurrence(iv(8761, 'hours')).ok).toBe(false);
    expect(parseRecurrence(iv(1e308, 'hours')).ok).toBe(false);
  });
});

describe('slotsBetween', () => {
  it('returns 501 slots of a 1-minute interval over a year, truncated, quickly', () => {
    const r = rec({ type: 'interval', every: 1, unit: 'minutes', startAt: '2026-01-01T00:00' });
    const t0 = performance.now();
    const res = slotsBetween(r, ZONE, d('2026-01-01T00:00:00Z'), d('2027-01-01T00:00:00Z'), 501);
    expect(performance.now() - t0).toBeLessThan(500);
    expect(res.slots).toHaveLength(501);
    expect(res.truncated).toBe(true);
  });

  it('includes both ends and is not truncated when everything fits', () => {
    const r = rec({ type: 'interval', every: 1, unit: 'hours', startAt: '2026-11-09T06:00' });
    const res = slotsBetween(r, ZONE, d('2026-11-09T12:00:00Z'), d('2026-11-09T14:00:00Z'), 10);
    expect(utc(res.slots)).toEqual(['2026-11-09T12:00Z', '2026-11-09T13:00Z', '2026-11-09T14:00Z']);
    expect(res.truncated).toBe(false);
  });

  it('reports no truncation when the count equals the limit exactly', () => {
    const r = rec({ type: 'interval', every: 1, unit: 'hours', startAt: '2026-11-09T06:00' });
    const res = slotsBetween(r, ZONE, d('2026-11-09T12:00:00Z'), d('2026-11-09T14:00:00Z'), 3);
    expect(res.slots).toHaveLength(3);
    expect(res.truncated).toBe(false);
  });
});

describe('previousOccurrence', () => {
  // Each pattern crosses both of the zone's clock changes.
  const FROM = '2026-01-01T00:00:00Z';
  const TO = '2028-06-01T00:00:00Z';
  const interval = { type: 'interval', every: 7, unit: 'hours', startAt: '2026-03-01T01:30' };
  const calendar = { startDate: '2026-02-20' };
  const PATTERNS: Array<[string, unknown]> = [
    ['once', { type: 'once', at: '2026-05-05T08:00' }],
    ['interval, no end', { ...interval }],
    ['interval, endAfter', { ...interval, range: { endAfter: 40 } }],
    ['interval, endBy', { ...interval, range: { endBy: '2026-04-02' } }],
    ['daily, two times, in the clock-change hours', {
      type: 'daily', every: 3, times: ['01:30', '02:30'], range: { ...calendar, endBy: '2026-12-01' },
    }],
    ['weekdays', { type: 'daily', weekdaysOnly: true, times: ['06:00'], range: { ...calendar, endAfter: 90 } }],
    ['every second week', weekly({ ...calendar, endBy: '2027-03-01' })],
    ['last Friday of the month', { ...lastFriday, range: { startDate: '2026-02-01', endAfter: 20 } }],
    ['yearly', { type: 'yearly', every: 1, month: 2, dayOfMonth: 29, times: ['12:00'], range: { startDate: '2026-01-01', endAfter: 2 } }],
  ];

  it.each(PATTERNS)('%s: walking back gives the forward slots in reverse, with their numbers', (_name, input) => {
    const r = rec(input);
    const { slots, truncated } = slotsBetween(r, ZONE, d(FROM), d(TO), 5000);
    expect(truncated).toBe(false);
    expect(slots.length).toBeGreaterThan(0);

    let cur = previousOccurrence(r, ZONE, new Date(d(TO).getTime() + 1));
    const back: Slot[] = [];
    while (cur) {
      back.push(cur);
      cur = previousOccurrence(r, ZONE, cur.at);
    }
    expect(back.reverse()).toEqual(slots);
  });

  it('is strictly before: a slot exactly at `before` is not returned', () => {
    const r = rec(interval);
    const first = nextOccurrence(r, ZONE, d(FROM))!;
    const second = nextOccurrence(r, ZONE, first.at)!;
    expect(previousOccurrence(r, ZONE, second.at)).toEqual(first);
    expect(previousOccurrence(r, ZONE, new Date(second.at.getTime() + 1))).toEqual(second);
    expect(previousOccurrence(r, ZONE, first.at)).toBeNull();
  });

  it('a 1-minute interval jumps back across a year at once', () => {
    const r = rec({ type: 'interval', every: 1, unit: 'minutes', startAt: '2026-11-09T01:00' });
    const started = performance.now();
    const slot = previousOccurrence(r, 'UTC', d('2027-11-09T01:00:30Z'));
    expect(performance.now() - started).toBeLessThan(500);
    expect(slot).toEqual({ at: d('2027-11-09T01:00:00Z'), number: 525_601 });
  });

  it('rejects an unknown zone, as the forward functions do', () => {
    expect(() => previousOccurrence(rec(interval), 'Mars/Olympus', d(TO))).toThrow(RangeError);
  });
});

describe('describeRecurrence', () => {
  it('describes shift patterns and intervals', () => {
    expect(describeRecurrence(rec({
      type: 'daily', weekdaysOnly: true, times: ['06:00', '14:00', '22:00'],
      range: { startDate: '2026-11-09', noEnd: true },
    }))).toBe('Weekdays at 06:00, 14:00, 22:00');
    expect(describeRecurrence(rec({
      type: 'interval', every: 4, unit: 'hours', startAt: '2026-11-09T06:00',
    }))).toBe('Every 4 hours');
  });
});

describe('parseRecurrence refuses unknown fields', () => {
  const range = { startDate: '2026-11-01', noEnd: true };
  const valid: Record<string, Record<string, unknown>> = {
    once: { type: 'once', at: '2026-11-10T06:00' },
    interval: { type: 'interval', every: 1, unit: 'hours', startAt: '2026-11-10T06:00' },
    daily: { type: 'daily', every: 1, times: ['06:00'], range },
    weekly: { type: 'weekly', every: 1, days: ['mon'], times: ['06:00'], range },
    monthly: { type: 'monthly', every: 1, dayOfMonth: 1, times: ['06:00'], range },
    yearly: { type: 'yearly', every: 1, month: 1, dayOfMonth: 1, times: ['06:00'], range },
  };

  for (const [type, input] of Object.entries(valid)) {
    it(`${type}: valid alone, refused with an extra field`, () => {
      expect(parseRecurrence(input).ok).toBe(true);
      const r = parseRecurrence({ ...input, extra: 1 });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.unknownFields).toEqual(['extra']);
        expect(r.problems).toEqual(['unknown field: extra']);
      }
    });
  }

  it('a key of another pattern is unknown here', () => {
    const r = parseRecurrence({ ...valid.daily, days: ['mon'], month: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.unknownFields).toEqual(['days', 'month']);
  });

  it('inside range, for calendar patterns and interval', () => {
    const cal = parseRecurrence({ ...valid.weekly, range: { ...range, rangee: 1 } });
    expect(!cal.ok && cal.unknownFields).toEqual(['range.rangee']);
    const every = parseRecurrence({ ...valid.interval, range: { noEnd: true, ends: 3 } });
    expect(!every.ok && every.unknownFields).toEqual(['range.ends']);
  });

  it('a misspelled range is named, and the missing one is still reported', () => {
    const r = parseRecurrence({ type: 'daily', every: 1, times: ['06:00'], rangee: range });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.unknownFields).toEqual(['rangee']);
      expect(r.problems).toContain('range is required');
    }
  });

  it('keeps its specific messages for the keys it knows', () => {
    const once = parseRecurrence({ ...valid.once, range: { noEnd: true } });
    expect(!once.ok && once.problems).toEqual(['once has no range']);
    const startDate = parseRecurrence({ ...valid.interval, range: { startDate: '2026-11-01', noEnd: true } });
    expect(!startDate.ok && startDate.problems).toEqual(['interval range has no startDate; it starts at startAt']);
  });
});
