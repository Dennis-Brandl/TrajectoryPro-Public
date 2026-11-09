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
import { useEffect, useId, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiErrorMessage } from '@/lib/api/client';
import { schedules } from '@/lib/api/schedules';
import type { Recurrence } from '@/lib/api/types';
import { formatInZone } from './schedule-format';
import { NativeSelect, NumField, RadioRow } from './form-controls';
import { todayDate } from './master-schedule-model';
import { ScheduleClockNote } from './ScheduleClockNote';

// The recurrence section, laid out like Outlook's dialog (spec 2026-11-08 §4.1, §10): a pattern
// column, that pattern's fields, the times, the range, and a live preview of the next fire times.

type Type = Exclude<Recurrence['type'], 'runOnce'>;
type CalendarRec = Extract<Recurrence, { range: unknown }>;
type RangeShape = { startDate?: string; noEnd?: true; endAfter?: number; endBy?: string };

const PATTERNS: { type: Type; label: string }[] = [
  { type: 'manual', label: 'Manual' }, { type: 'once', label: 'Once' }, { type: 'interval', label: 'Fixed delay' }, { type: 'daily', label: 'Daily' },
  { type: 'weekly', label: 'Weekly' }, { type: 'monthly', label: 'Monthly' }, { type: 'yearly', label: 'Yearly' },
];
const WEEKDAYS = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']] as const;
const ORDINALS = [['first', 'first'], ['second', 'second'], ['third', 'third'], ['fourth', 'fourth'], ['last', 'last']] as const;
const DAY_NAMES = [
  ['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday'],
  ['day', 'day'], ['weekday', 'weekday'], ['weekendDay', 'weekend day'],
] as const;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function switchType(v: Recurrence, type: Type): Recurrence {
  if (v.type === type) return v;
  const times = 'times' in v ? v.times : ['06:00'];
  const range = 'range' in v && v.range && 'startDate' in v.range ? v.range : { startDate: todayDate(), noEnd: true as const };
  switch (type) {
    case 'manual': return { type };
    case 'once': return { type, at: v.type === 'interval' ? v.startAt : '' };
    case 'interval': return { type, every: 1, unit: 'hours', startAt: v.type === 'once' ? v.at : '' };
    case 'daily': return { type, every: 1, times, range };
    case 'weekly': return { type, every: 1, days: [], times, range };
    case 'monthly': return { type, every: 1, dayOfMonth: 1, times, range };
    case 'yearly': return { type, every: 1, month: 1, dayOfMonth: 1, times, range };
  }
}

function endKind(r: RangeShape | undefined): 'none' | 'after' | 'by' {
  return r && 'endAfter' in r ? 'after' : r && 'endBy' in r ? 'by' : 'none';
}

export function RecurrenceForm({ workCenterId, value, onChange }: {
  workCenterId: string; value: Recurrence; onChange: (r: Recurrence) => void;
}) {
  const id = useId();
  // A key patched to undefined is removed, so the saved JSON carries only what the pattern uses.
  const patch = (p: Record<string, unknown>) => {
    const next: Record<string, unknown> = { ...value, ...p };
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    onChange(next as Recurrence);
  };

  return (
    <div className="grid gap-4 sm:grid-cols-[9rem_1fr]">
      <div role="radiogroup" aria-label="Pattern" className="space-y-1 text-sm">
        {PATTERNS.map((p) => (
          <label key={p.type} className="flex items-center gap-2">
            <input type="radio" name={`${id}-pattern`} checked={value.type === p.type} onChange={() => onChange(switchType(value, p.type))} />
            {p.label}
          </label>
        ))}
      </div>
      <div className="space-y-4">
        {value.type !== 'manual' && <ScheduleClockNote workCenterId={workCenterId} canSetZone />}
        <PatternFields id={id} value={value} patch={patch} />
        {'times' in value && <TimesField times={value.times} onChange={(times) => patch({ times })} />}
        {(value.type === 'interval' || 'times' in value) && <RangeFields id={id} value={value} onChange={onChange} />}
        {value.type !== 'manual' && <Preview workCenterId={workCenterId} value={value} />}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2 text-sm"><span>{label}</span>{children}</div>;
}

function PatternFields({ id, value, patch }: { id: string; value: Recurrence; patch: (p: Record<string, unknown>) => void }) {
  switch (value.type) {
    case 'manual':
      return <p className="text-sm text-muted-foreground">No start times. This schedule starts only when someone clicks Run Once, as for an incident response.</p>;
    case 'runOnce':
      return null;
    case 'once':
      return (
        <label className="flex flex-wrap items-center gap-2 text-sm">Date and time
          <Input type="datetime-local" className="w-56" value={value.at} onChange={(e) => patch({ at: e.target.value })} />
        </label>
      );
    case 'interval':
      return (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-2">Every
            <Input type="number" className="w-20" min={1} value={value.every}
              onChange={(e) => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 1) patch({ every: n }); }} />
          </label>
          <NativeSelect aria-label="Unit" value={value.unit} onChange={(e) => patch({ unit: e.target.value })}>
            <option value="minutes">Minutes</option><option value="hours">Hours</option>
          </NativeSelect>
          <label className="flex items-center gap-2">Start at
            <Input type="datetime-local" className="w-56" value={value.startAt} onChange={(e) => patch({ startAt: e.target.value })} />
          </label>
        </div>
      );
    case 'daily': {
      const weekdays = value.weekdaysOnly === true;
      return (
        <div className="space-y-2">
          <RadioRow name={`${id}-daily`} label="Every N days" checked={!weekdays}
            onSelect={() => patch({ every: value.every ?? 1, weekdaysOnly: undefined })}>
            <NumField label="Number of days" value={value.every ?? 1} onChange={(n) => patch({ every: n, weekdaysOnly: undefined })} />
          </RadioRow>
          <RadioRow name={`${id}-daily`} label="Every weekday" checked={weekdays}
            onSelect={() => patch({ weekdaysOnly: true, every: undefined })} />
        </div>
      );
    }
    case 'weekly':
      return (
        <div className="space-y-2">
          <Row label="Recur every"><NumField label="Weeks between" value={value.every} onChange={(n) => patch({ every: n })} /> <span>week(s) on</span></Row>
          <div className="flex flex-wrap gap-3">
            {WEEKDAYS.map(([d, label]) => (
              <label key={d} className="flex items-center gap-1 text-sm">
                <input type="checkbox" checked={value.days.includes(d)}
                  onChange={(e) => patch({ days: WEEKDAYS.map(([x]) => x).filter((x) => (x === d ? e.target.checked : value.days.includes(x))) })} />
                {label}
              </label>
            ))}
          </div>
        </div>
      );
    case 'monthly':
    case 'yearly':
      return <DayRuleFields id={id} value={value} patch={patch} />;
  }
}

function DayRuleFields({ id, value, patch }: {
  id: string; value: Extract<Recurrence, { type: 'monthly' | 'yearly' }>; patch: (p: Record<string, unknown>) => void;
}) {
  const byDay = 'dayOfMonth' in value;
  const yearly = value.type === 'yearly';
  return (
    <div className="space-y-2">
      <Row label="Recur every">
        <NumField label={yearly ? 'Years between' : 'Months between'} value={value.every} onChange={(n) => patch({ every: n })} />
        <span>{yearly ? 'year(s)' : 'month(s)'}</span>
        {yearly && (
          <NativeSelect aria-label="Month" value={String(value.month)} onChange={(e) => patch({ month: Number(e.target.value) })}>
            {MONTHS.map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
          </NativeSelect>
        )}
      </Row>
      <RadioRow name={`${id}-day`} label="On day" checked={byDay}
        onSelect={() => patch({ dayOfMonth: 1, ordinal: undefined, weekday: undefined })}>
        <NumField label="Day of month" value={'dayOfMonth' in value ? value.dayOfMonth : 1} max={31} onChange={(n) => patch({ dayOfMonth: n })} />
      </RadioRow>
      <RadioRow name={`${id}-day`} label="On the" checked={!byDay}
        onSelect={() => patch({ ordinal: 'first', weekday: 'mon', dayOfMonth: undefined })}>
        <NativeSelect aria-label="Ordinal" disabled={byDay} value={'ordinal' in value ? value.ordinal : 'first'} onChange={(e) => patch({ ordinal: e.target.value })}>
          {ORDINALS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </NativeSelect>
        <NativeSelect aria-label="Weekday" disabled={byDay} value={'weekday' in value ? value.weekday : 'mon'} onChange={(e) => patch({ weekday: e.target.value })}>
          {DAY_NAMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </NativeSelect>
      </RadioRow>
    </div>
  );
}

function TimesField({ times, onChange }: { times: string[]; onChange: (t: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    if (!TIME.test(draft) || times.includes(draft)) { setDraft(''); return; }
    onChange([...times, draft].sort());
    setDraft('');
  };
  return (
    <div className="space-y-2">
      <div className="text-sm">Times</div>
      <ul className="flex flex-wrap gap-2" aria-label="Times">
        {times.map((t) => (
          <li key={t} className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-sm">
            <span>{t}</span>
            <button type="button" aria-label={`Remove ${t}`} className="rounded px-1 text-muted-foreground hover:text-foreground"
              onClick={() => onChange(times.filter((x) => x !== t))}>×</button>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <Input type="time" aria-label="New time" className="w-32" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <Button type="button" variant="outline" size="sm" onClick={add}>Add time</Button>
      </div>
    </div>
  );
}

function RangeFields({ id, value, onChange }: { id: string; value: Exclude<Recurrence, { type: 'once' | 'manual' | 'runOnce' }>; onChange: (r: Recurrence) => void }) {
  const calendar = value.type !== 'interval';
  const range = value.range as RangeShape | undefined;
  const kind = endKind(range);
  const startDate = calendar ? (range?.startDate ?? '') : '';
  // Writes the range: calendar patterns always carry one; a Fixed delay's is optional.
  const setEnd = (end: { noEnd: true } | { endAfter: number } | { endBy: string } | null) => {
    if (!calendar) {
      const { range: _drop, ...rest } = value as Extract<Recurrence, { type: 'interval' }>;
      onChange(end === null ? rest : { ...rest, range: end });
    } else onChange({ ...value, range: { startDate, ...(end ?? { noEnd: true as const }) } } as CalendarRec);
  };
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm">Range</legend>
      {calendar && (
        <label className="flex flex-wrap items-center gap-2 text-sm">Start date
          <Input type="date" className="w-44" value={startDate}
            onChange={(e) => onChange({ ...value, range: { ...(range as object), startDate: e.target.value } } as CalendarRec)} />
        </label>
      )}
      <RadioRow name={`${id}-end`} label="No end" checked={kind === 'none'} onSelect={() => setEnd(calendar ? { noEnd: true } : null)} />
      <RadioRow name={`${id}-end`} label="End after" checked={kind === 'after'} onSelect={() => setEnd({ endAfter: 1 })}>
        <NumField label="Number of occurrences" value={range && 'endAfter' in range ? range.endAfter ?? 1 : 1}
          onChange={(n) => setEnd({ endAfter: n })} />
        <span className="text-sm">occurrences</span>
      </RadioRow>
      <RadioRow name={`${id}-end`} label="End by" checked={kind === 'by'} onSelect={() => setEnd({ endBy: '' })}>
        <Input type="date" aria-label="End date" className="w-44" value={range && 'endBy' in range ? range.endBy ?? '' : ''}
          onChange={(e) => setEnd({ endBy: e.target.value })} />
      </RadioRow>
    </fieldset>
  );
}

function Preview({ workCenterId, value }: { workCenterId: string; value: Recurrence }) {
  const [state, setState] = useState<{ times: string[]; zone: string } | { error: string } | null>(null);
  const body = JSON.stringify(value);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      schedules.previewRecurrence(workCenterId, JSON.parse(body) as Recurrence).then(
        (r) => { if (live) setState({ times: r.nextFireTimes, zone: r.timeZone }); },
        (err) => { if (live) setState({ error: apiErrorMessage(err, 'No preview yet') }); },
      );
    }, 300);
    return () => { live = false; clearTimeout(timer); };
  }, [workCenterId, body]);

  return (
    <div className="space-y-1 text-sm">
      <div className="font-medium">Next fire times</div>
      {state === null && <p className="text-muted-foreground">Working it out…</p>}
      {state && 'error' in state && <p className="text-muted-foreground">{state.error}</p>}
      {state && 'times' in state && (state.times.length === 0
        ? <p className="text-muted-foreground">No upcoming times: they have already passed in {state.zone}.</p>
        : (
          <ul aria-label="Next five fire times" className="space-y-0.5">
            {state.times.map((t) => <li key={t}>{formatInZone(t, state.zone)}</li>)}
          </ul>
        ))}
      {state && 'times' in state && <p className="text-xs text-muted-foreground">In the work center&apos;s time zone ({state.zone}).</p>}
    </div>
  );
}
