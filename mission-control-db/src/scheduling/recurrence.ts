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

// Recurrence patterns for work-center workflow scheduling (spec section 4).
// Pure date math with no database access: the editor preview and the engine
// call the same functions. Wall-clock and zone arithmetic uses luxon.

import { DateTime, IANAZone } from 'luxon';

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export type OrdinalWeekday = Weekday | 'day' | 'weekday' | 'weekendDay';
export type Ordinal = 'first' | 'second' | 'third' | 'fourth' | 'last';

/** How a range ends: exactly one of these. `endBy` is inclusive. */
export type RangeEnd = { noEnd: true } | { endAfter: number } | { endBy: string };
export type CalendarRange = { startDate: string } & RangeEnd;

type DayRule = { dayOfMonth: number } | { ordinal: Ordinal; weekday: OrdinalWeekday };

export type Recurrence =
  | { type: 'manual' }
  // Only a Run Once Runtime holds this, and `at` is an exact instant. It never comes from a definition.
  | { type: 'runOnce'; at: string }
  | { type: 'once'; at: string }
  | { type: 'interval'; every: number; unit: 'minutes' | 'hours'; startAt: string; range?: RangeEnd }
  | { type: 'daily'; every?: number; weekdaysOnly?: boolean; times: string[]; range: CalendarRange }
  | { type: 'weekly'; every: number; days: Weekday[]; times: string[]; range: CalendarRange }
  | ({ type: 'monthly'; every: number; times: string[]; range: CalendarRange } & DayRule)
  | ({ type: 'yearly'; every: number; month: number; times: string[]; range: CalendarRange } & DayRule);

/** `number` is the 1-based position from the range start. */
export type Slot = { at: Date; number: number };

const WEEKDAYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const ORDINALS: Ordinal[] = ['first', 'second', 'third', 'fourth', 'last'];
const ORDINAL_WEEKDAYS: OrdinalWeekday[] = [...WEEKDAYS, 'day', 'weekday', 'weekendDay'];
const LOCAL_DATE_TIME = "yyyy-MM-dd'T'HH:mm";
const MAX_PERIODS = 100_000;

// ---------------------------------------------------------------- parsing

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
const isPosInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1;
/** Largest `every` for calendar patterns, and for intervals (one year of minutes or hours). */
const MAX_EVERY = 1000;
const MAX_INTERVAL = { minutes: 525_600, hours: 8760 };
const isEvery = (v: unknown, max: number): v is number => isPosInt(v) && v <= max;
const isDate = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && DateTime.fromISO(v, { zone: 'utc' }).isValid;
const isDateTime = (v: unknown): v is string =>
  typeof v === 'string' && DateTime.fromFormat(v, LOCAL_DATE_TIME, { zone: 'utc' }).isValid;
const isTime = (v: unknown): v is string => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

function parseTimes(v: unknown, problems: string[]): string[] {
  if (!Array.isArray(v) || v.length === 0) {
    problems.push('times must be a non-empty list of HH:mm');
    return [];
  }
  const out: string[] = [];
  for (const t of v) {
    if (!isTime(t)) problems.push(`invalid time: ${String(t)}`);
    else if (!out.includes(t)) out.push(t);
  }
  return out.sort();
}

function parseEnd(v: Record<string, unknown>, problems: string[]): RangeEnd | null {
  const present = ['noEnd', 'endAfter', 'endBy'].filter((k) => v[k] !== undefined);
  if (present.length !== 1) {
    problems.push('range needs exactly one of noEnd, endAfter, endBy');
    return null;
  }
  if (v.noEnd !== undefined) {
    if (v.noEnd !== true) {
      problems.push('range.noEnd must be true');
      return null;
    }
    return { noEnd: true };
  }
  if (v.endAfter !== undefined) {
    if (!isPosInt(v.endAfter)) {
      problems.push('range.endAfter must be a whole number of at least 1');
      return null;
    }
    return { endAfter: v.endAfter };
  }
  if (!isDate(v.endBy)) {
    problems.push('range.endBy must be a date, YYYY-MM-DD');
    return null;
  }
  return { endBy: v.endBy };
}

function parseCalendarRange(v: unknown, problems: string[]): CalendarRange | null {
  if (!isRecord(v)) {
    problems.push('range is required');
    return null;
  }
  const start = v.startDate;
  if (!isDate(start)) problems.push('range.startDate must be a date, YYYY-MM-DD');
  const end = parseEnd(v, problems);
  if (!isDate(start) || !end) return null;
  return { startDate: start, ...end };
}

function parseDayRule(v: Record<string, unknown>, problems: string[]): DayRule | null {
  if (v.dayOfMonth !== undefined) {
    if (v.ordinal !== undefined || v.weekday !== undefined) {
      problems.push('use either dayOfMonth or ordinal with weekday, not both');
      return null;
    }
    if (!isPosInt(v.dayOfMonth) || v.dayOfMonth > 31) {
      problems.push('dayOfMonth must be 1 to 31');
      return null;
    }
    return { dayOfMonth: v.dayOfMonth };
  }
  const okOrd = ORDINALS.includes(v.ordinal as Ordinal);
  const okDay = ORDINAL_WEEKDAYS.includes(v.weekday as OrdinalWeekday);
  if (!okOrd || !okDay) {
    problems.push('needs dayOfMonth, or a valid ordinal with a valid weekday');
    return null;
  }
  return { ordinal: v.ordinal as Ordinal, weekday: v.weekday as OrdinalWeekday };
}

const RANGE_KEYS = ['startDate', 'noEnd', 'endAfter', 'endBy'];
const CALENDAR_KEYS = ['type', 'every', 'times', 'range'];
const DAY_RULE_KEYS = ['dayOfMonth', 'ordinal', 'weekday'];
/** `range` is listed for once, and startDate for interval's, because each has its own message. */
type DefinableType = Exclude<Recurrence['type'], 'runOnce'>;
const RECURRENCE_KEYS: Record<DefinableType, string[]> = {
  manual: ['type'],
  once: ['type', 'at', 'range'],
  interval: ['type', 'every', 'unit', 'startAt', 'range'],
  daily: [...CALENDAR_KEYS, 'weekdaysOnly'],
  weekly: [...CALENDAR_KEYS, 'days'],
  monthly: [...CALENDAR_KEYS, ...DAY_RULE_KEYS],
  yearly: [...CALENDAR_KEYS, ...DAY_RULE_KEYS, 'month'],
};

/** Keys this pattern does not have, as paths within the recurrence. An unknown type is reported on its own. */
function unknownRecurrenceFields(input: unknown): string[] {
  if (!isRecord(input) || !Object.hasOwn(RECURRENCE_KEYS, String(input.type))) return [];
  const type = input.type as DefinableType;
  const top = Object.keys(input).filter((k) => !RECURRENCE_KEYS[type].includes(k));
  const range = type !== 'once' && type !== 'manual' && isRecord(input.range)
    ? Object.keys(input.range).filter((k) => !RANGE_KEYS.includes(k)).map((k) => `range.${k}`) : [];
  return [...top, ...range];
}

/**
 * Refuses a key it does not know, so a misspelled field cannot silently change nothing.
 * `problems` holds every problem as text, the unknown fields first; `unknownFields` gives their paths.
 */
export function parseRecurrence(
  input: unknown,
): { ok: true; value: Recurrence } | { ok: false; problems: string[]; unknownFields: string[] } {
  const r = parseKnownFields(input);
  const unknownFields = unknownRecurrenceFields(input);
  if (r.ok && unknownFields.length === 0) return r;
  return { ok: false, problems: [...unknownFields.map((f) => `unknown field: ${f}`), ...(r.ok ? [] : r.problems)], unknownFields };
}

function parseKnownFields(
  input: unknown,
): { ok: true; value: Recurrence } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  const fail = () => ({ ok: false as const, problems });
  if (!isRecord(input)) return { ok: false, problems: ['recurrence must be an object'] };
  const type = input.type;

  if (type === 'manual') return { ok: true, value: { type: 'manual' } };

  if (type === 'once') {
    if (input.range !== undefined) problems.push('once has no range');
    if (!isDateTime(input.at)) problems.push('at must be a local date and time, YYYY-MM-DDTHH:mm');
    if (problems.length) return fail();
    return { ok: true, value: { type: 'once', at: input.at as string } };
  }

  if (type === 'interval') {
    const unit = input.unit;
    if (unit !== 'minutes' && unit !== 'hours') problems.push('unit must be minutes or hours');
    if (!isPosInt(input.every)) {
      problems.push('every must be a whole number of at least 1 (the minimum interval is 1 minute)');
    } else if (unit === 'minutes' || unit === 'hours') {
      if (input.every > MAX_INTERVAL[unit]) {
        problems.push(`every must be at most ${MAX_INTERVAL[unit]} ${unit}`);
      }
    }
    if (!isDateTime(input.startAt)) problems.push('startAt must be a local date and time, YYYY-MM-DDTHH:mm');
    let range: RangeEnd | undefined;
    if (input.range !== undefined) {
      if (!isRecord(input.range)) problems.push('range must be an object');
      else if (input.range.startDate !== undefined) {
        problems.push('interval range has no startDate; it starts at startAt');
      } else range = parseEnd(input.range, problems) ?? undefined;
    }
    if (problems.length) return fail();
    const base = {
      type: 'interval' as const,
      every: input.every as number,
      unit: unit as 'minutes' | 'hours',
      startAt: input.startAt as string,
    };
    return { ok: true, value: range ? { ...base, range } : base };
  }

  if (type === 'daily' || type === 'weekly' || type === 'monthly' || type === 'yearly') {
    const times = parseTimes(input.times, problems);
    const range = parseCalendarRange(input.range, problems);
    if (type === 'daily') {
      const weekdaysOnly = input.weekdaysOnly === true;
      if (input.weekdaysOnly !== undefined && typeof input.weekdaysOnly !== 'boolean') {
        problems.push('weekdaysOnly must be true or false');
      }
      if (!weekdaysOnly && !isEvery(input.every, MAX_EVERY)) {
        problems.push(`daily needs every (days, a whole number from 1 to ${MAX_EVERY}) or weekdaysOnly`);
      }
      if (weekdaysOnly && input.every !== undefined) problems.push('use either every or weekdaysOnly, not both');
      if (problems.length || !range) return fail();
      const value: Recurrence = weekdaysOnly
        ? { type: 'daily', weekdaysOnly: true, times, range }
        : { type: 'daily', every: input.every as number, times, range };
      return { ok: true, value };
    }
    if (!isEvery(input.every, MAX_EVERY)) problems.push(`every must be a whole number from 1 to ${MAX_EVERY}`);
    if (type === 'weekly') {
      const days = input.days;
      if (!Array.isArray(days) || days.length === 0) problems.push('days must be a non-empty list');
      else if (!days.every((d) => WEEKDAYS.includes(d as Weekday))) problems.push('days must be mon to sun');
      if (problems.length || !range) return fail();
      const sorted = WEEKDAYS.filter((d) => (days as Weekday[]).includes(d));
      return { ok: true, value: { type: 'weekly', every: input.every as number, days: sorted, times, range } };
    }
    if (type === 'yearly' && !(isPosInt(input.month) && input.month <= 12)) problems.push('month must be 1 to 12');
    const rule = parseDayRule(input, problems);
    if (problems.length || !range || !rule) return fail();
    if (type === 'monthly') {
      return { ok: true, value: { type: 'monthly', every: input.every as number, times, range, ...rule } };
    }
    return {
      ok: true,
      value: { type: 'yearly', every: input.every as number, month: input.month as number, times, range, ...rule },
    };
  }

  return { ok: false, problems: ['type must be manual, once, interval, daily, weekly, monthly or yearly'] };
}

// ------------------------------------------------------------ date helpers

type Day = DateTime; // a calendar date held at midnight UTC, for zone-free arithmetic

const utcDay = (iso: string): Day => DateTime.fromISO(iso, { zone: 'utc' });
const isoOf = (d: Day): string => d.toISODate() as string;

function dayMatches(d: Day, w: OrdinalWeekday): boolean {
  const idx = d.weekday - 1; // 0 = Monday
  if (w === 'day') return true;
  if (w === 'weekday') return idx < 5;
  if (w === 'weekendDay') return idx >= 5;
  return WEEKDAYS[idx] === w;
}

function ordinalDay(year: number, month: number, ordinal: Ordinal, w: OrdinalWeekday): Day {
  const first = DateTime.utc(year, month, 1);
  const matches: Day[] = [];
  for (let i = 0; i < (first.daysInMonth as number); i++) {
    const d = first.plus({ days: i });
    if (dayMatches(d, w)) matches.push(d);
  }
  return (ordinal === 'last' ? matches[matches.length - 1] : matches[ORDINALS.indexOf(ordinal)]) as Day;
}

function ruleDay(year: number, month: number, rule: DayRule): Day {
  if ('dayOfMonth' in rule) {
    const first = DateTime.utc(year, month, 1);
    return first.set({ day: Math.min(rule.dayOfMonth, first.daysInMonth as number) });
  }
  return ordinalDay(year, month, rule.ordinal, rule.weekday);
}

/** The instant a local date and HH:mm fall on, with the spec's clock-change rules. */
function resolveInstant(day: Day, time: string, zone: string): number {
  const [h, m] = time.split(':').map(Number) as [number, number];
  const dt = DateTime.fromObject({ year: day.year, month: day.month, day: day.day, hour: h, minute: m }, { zone });
  if (dt.hour !== h || dt.minute !== m) {
    // The time falls in a spring-forward gap: fire at the first valid moment, the gap's end.
    const offsetAfter = dt.zone.offset(dt.toMillis());
    let lo = dt.toMillis() - 86_400_000; // the offset here differs from offsetAfter
    let hi = dt.toMillis(); // the offset here equals offsetAfter
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (dt.zone.offset(mid) === offsetAfter) hi = mid;
      else lo = mid;
    }
    return hi;
  }
  // A time that happens twice (clocks going back) fires only the first time.
  const prev = dt.toMillis() - 3_600_000;
  const earlier = DateTime.fromMillis(prev, { zone });
  if (earlier.hour === h && earlier.minute === m && earlier.day === day.day) return prev;
  return dt.toMillis();
}

// -------------------------------------------------------------- generation

/** Local dates of each period, ascending, from the range start. Infinite. */
function* periods(r: Exclude<Recurrence, { type: 'manual' | 'runOnce' | 'once' | 'interval' }>): Generator<Day[]> {
  const start = utcDay(r.range.startDate);
  const keep = (ds: Day[]) => ds.filter((d) => d >= start);
  if (r.type === 'daily') {
    const step = r.weekdaysOnly ? 1 : (r.every ?? 1);
    for (let p = 0; ; p++) {
      const d = start.plus({ days: p * step });
      yield r.weekdaysOnly && d.weekday > 5 ? [] : [d];
    }
  } else if (r.type === 'weekly') {
    const monday = start.startOf('week'); // weeks count from the Monday of the startDate week
    for (let p = 0; ; p++) {
      const wk = monday.plus({ weeks: p * r.every });
      yield keep(r.days.map((w) => wk.plus({ days: WEEKDAYS.indexOf(w) })));
    }
  } else if (r.type === 'monthly') {
    for (let p = 0; ; p++) {
      const mo = start.startOf('month').plus({ months: p * r.every });
      yield keep([ruleDay(mo.year, mo.month, r)]);
    }
  } else {
    for (let p = 0; ; p++) {
      yield keep([ruleDay(start.year + p * r.every, r.month, r)]);
    }
  }
}

/** A local YYYY-MM-DDTHH:mm as an instant in `zone`. */
export function localToInstant(at: string, zone: string): Date {
  return DateTime.fromFormat(at, LOCAL_DATE_TIME, { zone }).toJSDate();
}

/** True for a well-formed local YYYY-MM-DDTHH:mm. */
export const isLocalDateTime = isDateTime;

/** An instant as a person reads it in `zone`, for messages. */
export function describeInstant(at: Date, zone: string): string {
  return DateTime.fromJSDate(at, { zone }).toFormat("yyyy-MM-dd HH:mm");
}

function endOf(r: Recurrence): RangeEnd {
  return ('range' in r && r.range) || { noEnd: true };
}

/** Every slot at or after `fromMs`, in order, until the range ends. */
function* slotsFrom(r: Recurrence, zone: string, fromMs: number): Generator<Slot> {
  if (!IANAZone.isValidZone(zone)) throw new RangeError(`Unknown time zone: ${zone}`);
  if (r.type === 'manual') return;
  if (r.type === 'runOnce') {
    const at = new Date(r.at);
    if (at.getTime() >= fromMs) yield { at, number: 1 };
    return;
  }
  if (r.type === 'once') {
    const at = localToInstant(r.at, zone).getTime();
    if (at >= fromMs) yield { at: new Date(at), number: 1 };
    return;
  }
  const end = endOf(r);
  if (r.type === 'interval') {
    // Elapsed-time arithmetic from startAt: O(1) to jump to `fromMs`.
    const step = (r.unit === 'hours' ? 3_600_000 : 60_000) * r.every;
    const t0 = DateTime.fromFormat(r.startAt, LOCAL_DATE_TIME, { zone }).toMillis();
    for (let k = fromMs <= t0 ? 0 : Math.ceil((fromMs - t0) / step); ; k++) {
      const ms = t0 + k * step;
      if ('endAfter' in end && k + 1 > end.endAfter) return;
      if ('endBy' in end && (DateTime.fromMillis(ms, { zone }).toISODate() as string) > end.endBy) return;
      yield { at: new Date(ms), number: k + 1 };
    }
  }
  // Calendar patterns: dates more than a day before `fromMs` are only counted,
  // never resolved to instants, so the slot number stays cheap and stable.
  const fromDay = DateTime.fromMillis(fromMs, { zone }).toISODate() as string;
  const skipBefore = isoOf(utcDay(fromDay).minus({ days: 1 }));
  let number = 0;
  let n = 0;
  for (const dates of periods(r)) {
    if (++n > MAX_PERIODS) return;
    for (const day of dates) {
      const iso = isoOf(day);
      if ('endBy' in end && iso > end.endBy) return;
      for (const time of r.times) {
        number++;
        if ('endAfter' in end && number > end.endAfter) return;
        if (iso < skipBefore) continue;
        const ms = resolveInstant(day, time, zone);
        if (ms >= fromMs) yield { at: new Date(ms), number };
      }
    }
  }
}

/** The first slot strictly after `after`, or null when the pattern has ended. */
export function nextOccurrence(r: Recurrence, zone: string, after: Date): Slot | null {
  const first = slotsFrom(r, zone, after.getTime() + 1).next();
  return first.done ? null : first.value;
}

/**
 * The last slot strictly before `before`, or null when there is none. Intervals are arithmetic.
 * Calendar patterns scan forward from the range start, as a slot's number needs that count anyway,
 * resolving only the dates near `before` to instants.
 */
export function previousOccurrence(r: Recurrence, zone: string, before: Date): Slot | null {
  if (!IANAZone.isValidZone(zone)) throw new RangeError(`Unknown time zone: ${zone}`);
  const beforeMs = before.getTime();
  if (r.type === 'manual') return null;
  if (r.type === 'runOnce') {
    const at = new Date(r.at);
    return at.getTime() < beforeMs ? { at, number: 1 } : null;
  }
  if (r.type === 'once') {
    const at = localToInstant(r.at, zone).getTime();
    return at < beforeMs ? { at: new Date(at), number: 1 } : null;
  }
  const end = endOf(r);
  if (r.type === 'interval') {
    const step = (r.unit === 'hours' ? 3_600_000 : 60_000) * r.every;
    const t0 = DateTime.fromFormat(r.startAt, LOCAL_DATE_TIME, { zone }).toMillis();
    let k = Math.ceil((beforeMs - t0) / step) - 1;
    if ('endAfter' in end) k = Math.min(k, end.endAfter - 1);
    if ('endBy' in end) {
      const lastMs = DateTime.fromISO(end.endBy, { zone }).endOf('day').toMillis();
      k = Math.min(k, Math.floor((lastMs - t0) / step));
    }
    return k < 0 ? null : { at: new Date(t0 + k * step), number: k + 1 };
  }
  const beforeDay = utcDay(DateTime.fromMillis(beforeMs, { zone }).toISODate() as string);
  const nearFrom = isoOf(beforeDay.minus({ days: 1 }));
  const nearTo = isoOf(beforeDay.plus({ days: 1 }));
  let last: { day: Day; time: string; number: number } | null = null;
  let number = 0;
  let n = 0;
  scan: for (const dates of periods(r)) {
    if (++n > MAX_PERIODS) break;
    for (const day of dates) {
      const iso = isoOf(day);
      if (iso > nearTo || ('endBy' in end && iso > end.endBy)) break scan;
      for (const time of r.times) {
        number++;
        if ('endAfter' in end && number > end.endAfter) break scan;
        if (iso >= nearFrom && resolveInstant(day, time, zone) >= beforeMs) break scan;
        last = { day, time, number };
      }
    }
  }
  return last && { at: new Date(resolveInstant(last.day, last.time, zone)), number: last.number };
}

/** Slots with from <= at <= to. `truncated` is true when more than `limit` exist. */
export function slotsBetween(
  r: Recurrence,
  zone: string,
  from: Date,
  to: Date,
  limit: number,
): { slots: Slot[]; truncated: boolean } {
  const slots: Slot[] = [];
  for (const s of slotsFrom(r, zone, from.getTime())) {
    if (s.at.getTime() > to.getTime()) break;
    if (slots.length >= limit) return { slots, truncated: true };
    slots.push(s);
  }
  return { slots, truncated: false };
}

// ------------------------------------------------------------ description

const DAY_NAME: Record<OrdinalWeekday, string> = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
  day: 'day', weekday: 'weekday', weekendDay: 'weekend day',
};
const MONTH_NAME = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function every(n: number, one: string, many: string): string {
  return n === 1 ? `Every ${one}` : `Every ${n} ${many}`;
}

export function describeRecurrence(r: Recurrence): string {
  if (r.type === 'manual') return 'Manual, starts only with Run Once';
  if (r.type === 'runOnce') return 'Run Once';
  if (r.type === 'once') return `Once on ${r.at.replace('T', ' at ')}`;
  if (r.type === 'interval') return every(r.every, r.unit === 'hours' ? 'hour' : 'minute', r.unit);
  const at = ` at ${r.times.join(', ')}`;
  if (r.type === 'daily') return (r.weekdaysOnly ? 'Weekdays' : every(r.every ?? 1, 'day', 'days')) + at;
  if (r.type === 'weekly') {
    const days = r.days.map((d) => DAY_NAME[d].slice(0, 3)).join(', ');
    return `${every(r.every, 'week', 'weeks')} on ${days}${at}`;
  }
  const cadence = (one: string, many: string) => every(r.every, one, many).toLowerCase();
  if (r.type === 'monthly') {
    const which = 'dayOfMonth' in r ? `Day ${r.dayOfMonth}` : `The ${r.ordinal} ${DAY_NAME[r.weekday]}`;
    return `${which} of ${cadence('month', 'months')}${at}`;
  }
  const month = MONTH_NAME[r.month - 1] as string;
  const when = 'dayOfMonth' in r ? `${month} ${r.dayOfMonth}` : `The ${r.ordinal} ${DAY_NAME[r.weekday]} of ${month}`;
  return `${when}, ${cadence('year', 'years')}${at}`;
}
