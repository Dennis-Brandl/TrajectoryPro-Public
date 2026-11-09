// @vitest-environment jsdom
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
import { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/api/schedules', () => ({ schedules: { previewRecurrence: vi.fn(), clock: vi.fn(async () => ({ timeZone: 'UTC', workCenterZoneSet: true })) } }));
import { schedules } from '@/lib/api/schedules';
import type { Recurrence } from '@/lib/api/types';
import { RecurrenceForm } from './RecurrenceForm';

function Harness({ initial }: { initial: Recurrence }) {
  const [value, setValue] = useState<Recurrence>(initial);
  return (
    <>
      <RecurrenceForm workCenterId="w1" value={value} onChange={setValue} />
      <pre data-testid="json">{JSON.stringify(value)}</pre>
    </>
  );
}
const out = () => JSON.parse(screen.getByTestId('json').textContent!) as Recurrence;
const set = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const pick = (name: string) => userEvent.click(screen.getByRole('radio', { name }));
const START: Recurrence = { type: 'once', at: '' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(schedules.previewRecurrence).mockResolvedValue({
    nextFireTimes: ['2026-11-09T12:00:00Z', '2026-11-09T20:00:00Z', '2026-11-10T04:00:00Z', '2026-11-10T12:00:00Z', '2026-11-10T20:00:00Z'],
    recurrenceText: 'x', timeZone: 'UTC',
  } as never);
});
afterEach(cleanup);

// Spec 4.2: every example, built by filling the form's own fields, then loaded back unchanged.
type Example = { name: string; json: Recurrence; fill: () => Promise<void> | void; shows: () => void };
const examples: Example[] = [
  {
    name: 'every 4 hours',
    json: { type: 'interval', every: 4, unit: 'hours', startAt: '2026-11-09T06:00' },
    fill: async () => {
      await pick('Fixed delay'); set('Every', '4'); await userEvent.selectOptions(screen.getByLabelText('Unit'), 'hours');
      set('Start at', '2026-11-09T06:00');
    },
    shows: () => { expect(screen.getByRole('radio', { name: 'Fixed delay' })).toBeChecked(); expect(screen.getByLabelText('Every')).toHaveValue(4); },
  },
  {
    name: 'every weekday at three shift starts',
    json: { type: 'daily', weekdaysOnly: true, times: ['06:00', '14:00', '22:00'], range: { startDate: '2026-11-09', noEnd: true } },
    fill: async () => {
      await pick('Daily'); await pick('Every weekday');
      for (const t of ['22:00', '14:00']) { set('New time', t); await userEvent.click(screen.getByRole('button', { name: 'Add time' })); }
      set('Start date', '2026-11-09');
    },
    shows: () => { expect(screen.getByRole('radio', { name: 'Every weekday' })).toBeChecked(); expect(screen.getByText('14:00')).toBeInTheDocument(); },
  },
  {
    name: 'every other week, Monday and Thursday',
    json: { type: 'weekly', every: 2, days: ['mon', 'thu'], times: ['06:00'], range: { startDate: '2026-11-09', noEnd: true } },
    fill: async () => {
      await pick('Weekly'); set('Weeks between', '2');
      await userEvent.click(screen.getByRole('checkbox', { name: 'Mon' })); await userEvent.click(screen.getByRole('checkbox', { name: 'Thu' }));
      set('Start date', '2026-11-09');
    },
    shows: () => { expect(screen.getByRole('checkbox', { name: 'Thu' })).toBeChecked(); expect(screen.getByRole('checkbox', { name: 'Tue' })).not.toBeChecked(); },
  },
  {
    name: 'last Friday of every month, six times',
    json: { type: 'monthly', every: 1, ordinal: 'last', weekday: 'fri', times: ['18:00'], range: { startDate: '2026-11-01', endAfter: 6 } },
    fill: async () => {
      await pick('Monthly'); await pick('On the');
      await userEvent.selectOptions(screen.getByLabelText('Ordinal'), 'last'); await userEvent.selectOptions(screen.getByLabelText('Weekday'), 'fri');
      await userEvent.click(screen.getByRole('button', { name: 'Remove 06:00' }));
      set('New time', '18:00'); await userEvent.click(screen.getByRole('button', { name: 'Add time' }));
      set('Start date', '2026-11-01'); await pick('End after'); set('Number of occurrences', '6');
    },
    shows: () => { expect(screen.getByRole('radio', { name: 'On the' })).toBeChecked(); expect(screen.getByLabelText('Weekday')).toHaveValue('fri'); expect(screen.getByLabelText('Number of occurrences')).toHaveValue(6); },
  },
  {
    name: 'the 31st of every month',
    json: { type: 'monthly', every: 1, dayOfMonth: 31, times: ['08:00'], range: { startDate: '2027-01-01', noEnd: true } },
    fill: async () => {
      await pick('Monthly'); set('Day of month', '31');
      await userEvent.click(screen.getByRole('button', { name: 'Remove 06:00' }));
      set('New time', '08:00'); await userEvent.click(screen.getByRole('button', { name: 'Add time' }));
      set('Start date', '2027-01-01');
    },
    shows: () => { expect(screen.getByRole('radio', { name: 'On day' })).toBeChecked(); expect(screen.getByLabelText('Day of month')).toHaveValue(31); },
  },
  {
    name: 'first Monday in November, yearly',
    json: { type: 'yearly', every: 1, month: 11, ordinal: 'first', weekday: 'mon', times: ['07:00'], range: { startDate: '2026-11-01', noEnd: true } },
    fill: async () => {
      await pick('Yearly'); await userEvent.selectOptions(screen.getByLabelText('Month'), '11'); await pick('On the');
      await userEvent.selectOptions(screen.getByLabelText('Ordinal'), 'first'); await userEvent.selectOptions(screen.getByLabelText('Weekday'), 'mon');
      await userEvent.click(screen.getByRole('button', { name: 'Remove 06:00' }));
      set('New time', '07:00'); await userEvent.click(screen.getByRole('button', { name: 'Add time' }));
      set('Start date', '2026-11-01');
    },
    shows: () => { expect(screen.getByLabelText('Month')).toHaveValue('11'); expect(screen.getByLabelText('Ordinal')).toHaveValue('first'); },
  },
  {
    name: 'once, Tuesday at 09:30',
    json: { type: 'once', at: '2026-11-10T09:30' },
    fill: () => { set('Date and time', '2026-11-10T09:30'); },
    shows: () => { expect(screen.getByLabelText('Date and time')).toHaveValue('2026-11-10T09:30'); },
  },
];

it('Manual has no time fields or preview, and saves as just its type', async () => {
  render(<Harness initial={START} />);
  await pick('Manual');
  vi.mocked(schedules.previewRecurrence).mockClear(); // the starting pattern's own preview may already have run
  expect(out()).toEqual({ type: 'manual' });
  expect(screen.getByText(/starts only when someone clicks Run Once/)).toBeInTheDocument();
  expect(screen.queryByLabelText('Date and time')).toBeNull();
  expect(screen.queryByText('Next fire times')).toBeNull();
  expect(schedules.previewRecurrence).not.toHaveBeenCalled();
  await pick('Once');
  expect(out()).toEqual({ type: 'once', at: '' });
});

describe('RecurrenceForm', () => {
  for (const ex of examples) {
    it(`builds "${ex.name}" from its fields`, async () => {
      render(<Harness initial={START} />);
      await ex.fill();
      expect(out()).toEqual(ex.json);
    });
    it(`loads "${ex.name}" back unchanged`, () => {
      render(<Harness initial={ex.json} />);
      ex.shows();
      expect(out()).toEqual(ex.json);
    });
  }

  it('Remove drops a time and Add keeps the list sorted without repeats', async () => {
    render(<Harness initial={{ type: 'daily', every: 1, times: ['14:00'], range: { startDate: '2026-11-09', noEnd: true } }} />);
    set('New time', '06:00'); await userEvent.click(screen.getByRole('button', { name: 'Add time' }));
    set('New time', '06:00'); await userEvent.click(screen.getByRole('button', { name: 'Add time' }));
    expect((out() as { times: string[] }).times).toEqual(['06:00', '14:00']);
    await userEvent.click(screen.getByRole('button', { name: 'Remove 14:00' }));
    expect((out() as { times: string[] }).times).toEqual(['06:00']);
  });

  it('an interval range is optional: End by a date adds it, No end removes it', async () => {
    render(<Harness initial={{ type: 'interval', every: 1, unit: 'hours', startAt: '2026-11-09T06:00' }} />);
    expect(screen.getByRole('radio', { name: 'No end' })).toBeChecked();
    await pick('End by'); set('End date', '2026-12-01');
    expect(out()).toMatchObject({ range: { endBy: '2026-12-01' } });
    await pick('No end');
    expect('range' in out()).toBe(false);
  });

  it('asks for the next five fire times and lists them', async () => {
    const rec: Recurrence = { type: 'daily', every: 1, times: ['06:00'], range: { startDate: '2026-11-09', noEnd: true } };
    render(<Harness initial={rec} />);
    const list = await screen.findByRole('list', { name: 'Next five fire times' });
    expect(schedules.previewRecurrence).toHaveBeenCalledWith('w1', rec);
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(5));
  });
});
