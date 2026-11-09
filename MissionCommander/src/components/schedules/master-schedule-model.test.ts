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
import type { Recurrence, ScheduleDefinition } from '@/lib/api/types';
import { parseScheduleDefinition } from 'mission-control-db/src/scheduling/definition';
import { fromDefinition, toDefinition } from './master-schedule-model';

const CAL = { startDate: '2026-11-09', noEnd: true as const };
const RECURRENCES: Recurrence[] = [
  { type: 'once', at: '2026-11-10T09:30' },
  { type: 'interval', every: 4, unit: 'hours', startAt: '2026-11-09T06:00', range: { noEnd: true } },
  { type: 'interval', every: 30, unit: 'minutes', startAt: '2026-11-09T06:00' },
  { type: 'daily', weekdaysOnly: true, times: ['06:00', '14:00', '22:00'], range: CAL },
  { type: 'daily', every: 2, times: ['06:00'], range: { startDate: '2026-11-09', endAfter: 5 } },
  { type: 'weekly', every: 2, days: ['mon', 'thu'], times: ['06:00'], range: CAL },
  { type: 'monthly', every: 1, ordinal: 'last', weekday: 'fri', times: ['18:00'], range: { startDate: '2026-11-01', endBy: '2027-01-01' } },
  { type: 'monthly', every: 1, dayOfMonth: 31, times: ['08:00'], range: CAL },
  { type: 'yearly', every: 1, month: 11, ordinal: 'first', weekday: 'mon', times: ['07:00'], range: CAL },
];

// The shapes an API sender can store: its own ending order, an empty params object, a stored blank
// fixed value, nested chains, and a blank or whitespace description.
const definition = (recurrence: Recurrence, description?: string): ScheduleDefinition => ({
  name: 'Nightly',
  ...(description === undefined ? {} : { description }),
  recurrence,
  items: [
    {
      workflow: { name: 'A', version: '1.0.0' }, params: {},
      chain: [
        {
          workflow: { name: 'B' }, triggerOn: ['errored', 'completed', 'aborted'], params: { P: { value: '' }, Q: { value: '7' } },
          chain: [{ workflow: { name: 'C' }, triggerOn: ['stopped', 'completed'], params: { R: { from: 'trigger.output', name: 'Yield', fallback: 'x' } }, chain: [] }],
        },
      ],
    },
    { workflow: { name: 'D' } },
  ],
});

describe('master schedule model: an unchanged load reproduces the stored body', () => {
  for (const [n, rec] of RECURRENCES.entries()) {
    it(`recurrence ${n + 1}: ${rec.type}`, () => {
      const loaded = definition(rec, ['', '  ', 'Nightly run'][n % 3]);
      // chain: [] on a leaf is not stored by the server (it omits empty chains); load what it would send.
      const stored = JSON.parse(JSON.stringify(loaded).replace(',"chain":[]', '')) as ScheduleDefinition;
      expect(toDefinition(fromDefinition(stored))).toEqual(stored);
    });
  }

  it('without a description none is added; a description the user types is saved', () => {
    const stored = definition(RECURRENCES[0]!);
    expect('description' in toDefinition(fromDefinition(stored))).toBe(false);
    const state = fromDefinition(stored);
    expect(toDefinition({ ...state, description: 'x' }).description).toBe('x');
  });

  it('a blank fixed value the user makes is still left out', () => {
    const state = fromDefinition({ name: 'n', recurrence: RECURRENCES[0]!, items: [{ workflow: { name: 'A' } }] });
    const edited = { ...state, items: [{ ...state.items[0]!, params: { P: { value: '' }, Q: { value: '1' } } }] };
    expect(toDefinition(edited).items[0]!.params).toEqual({ Q: { value: '1' } });
  });
});

describe('what the editor saves passes the strict parser', () => {
  const view = {
    id: 'a', workCenterId: 'b', source: 'api', externalKey: 'K', revision: 3, recurrenceText: 'x', updatedAt: 'y', managedBy: 'ERP', timeZone: 'UTC',
  };
  for (const [n, rec] of RECURRENCES.entries()) {
    it(`recurrence ${n + 1}: ${rec.type}: a loaded Master's view fields are not sent`, () => {
      const stored = JSON.parse(JSON.stringify(definition(rec, 'x')).replace(',"chain":[]', '')) as ScheduleDefinition;
      const out = toDefinition(fromDefinition({ ...stored, ...view } as ScheduleDefinition));
      expect(Object.keys(out).sort()).toEqual(['description', 'items', 'name', 'recurrence']);
      const parsed = parseScheduleDefinition(out);
      expect(parsed.ok ? [] : parsed.problems).toEqual([]);
    });
  }
  it('editor-only item fields stay behind', () => {
    const state = fromDefinition({ name: 'n', recurrence: RECURRENCES[0]!, items: [{ workflow: { name: 'A' } }] });
    const out = toDefinition({ ...state, items: [{ ...state.items[0]!, note: 'changed' }] });
    expect(Object.keys(out.items[0]!)).toEqual(['workflow']);
    expect(parseScheduleDefinition(out).ok).toBe(true);
  });
});
