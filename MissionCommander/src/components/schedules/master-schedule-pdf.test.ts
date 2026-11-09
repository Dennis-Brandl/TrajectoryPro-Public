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
import type { MasterScheduleRecord } from '@/lib/api/types';
import {
  buildMasterScheduleModel, masterSchedulePdfName, rangeText, renderMasterSchedulePdf, valueSourceText,
} from './master-schedule-pdf';

const RECORD: MasterScheduleRecord = {
  workCenterName: 'Line 1', timeZone: 'America/Chicago',
  master: {
    id: 'm1', workCenterId: 'w1', name: 'Day Production', description: 'Two batches a day', source: 'commander', externalKey: null,
    revision: 3, recurrenceText: 'Weekdays at 06:00', updatedAt: '2026-11-09T14:46:00Z', managedBy: null,
    recurrence: { type: 'daily', weekdaysOnly: true, times: ['06:00'], range: { startDate: '2026-11-01', endAfter: 20 } },
    items: [{
      workflow: { name: 'Blend', version: '2.0' }, params: { BatchId: { template: 'B-{occurrence.number}' }, Size: { value: '25' } },
      chain: [{ workflow: { name: 'Move' }, triggerOn: ['completed', 'aborted'], params: { BatchId: { from: 'trigger.input', name: 'BatchId' } } }],
    }, { workflow: { name: 'Inspect' } }],
  },
  changes: [
    { version: 1, at: '2026-11-01T13:00:00Z', actorKind: 'user', actorName: 'una', reason: 'Initial version' },
    { version: 2, at: '2026-11-05T15:30:00Z', actorKind: 'api_client', actorName: 'ERP', reason: 'Sent through the REST interface' },
    { version: 3, at: '2026-11-09T14:46:00Z', actorKind: 'user', actorName: 'dbrandl', reason: null },
  ],
} as unknown as MasterScheduleRecord;

describe('Master Schedule PDF', () => {
  const model = buildMasterScheduleModel(RECORD, { now: new Date('2026-11-09T20:00:00Z'), loginName: 'qa' });

  it('heads with the version, work center, zone and the full recurrence', () => {
    expect(model.title).toBe('Master Schedule: Day Production');
    expect(Object.fromEntries(model.header)).toMatchObject({
      Version: '3', 'Work center': 'Line 1', 'Time zone': 'America/Chicago', Source: 'Mission Commander',
      'Last saved': '2026-11-09 08:46', Recurrence: 'Weekdays at 06:00, from 2026-11-01, ending after 20 occurrences',
      Description: 'Two batches a day',
    });
    expect(model.footerLeft).toBe('Day Production version 3 · Exported 2026-11-09 14:00 by qa');
  });

  it('lists every workflow in tree order with how it starts and where its values come from', () => {
    expect(model.workflows).toEqual([
      { number: '1', name: 'Blend', version: '2.0', starts: 'At each scheduled time, in list order', values: 'BatchId = template "B-{occurrence.number}"\nSize = "25"' },
      { number: '1.1', name: 'Move', version: 'Current at Enable', starts: 'When 1 completes or is aborted', values: 'BatchId = starting value "BatchId" of the run that triggered it' },
      { number: '2', name: 'Inspect', version: 'Current at Enable', starts: 'At each scheduled time, in list order', values: '(defaults)' },
    ]);
  });

  it('carries the change history, oldest first, in the work center zone (Nov 1 is after the clocks went back)', () => {
    expect(model.changes).toEqual([
      { version: '1', at: '2026-11-01 07:00', who: 'una', reason: 'Initial version' },
      { version: '2', at: '2026-11-05 09:30', who: 'ERP (API client)', reason: 'Sent through the REST interface' },
      { version: '3', at: '2026-11-09 08:46', who: 'dbrandl', reason: '(no reason recorded)' },
    ]);
  });

  it('renders a PDF that holds the history, and names the file by version', () => {
    const doc = renderMasterSchedulePdf(model);
    const raw = doc.output();
    expect(raw.startsWith('%PDF-')).toBe(true);
    for (const t of ['Change history', 'Sent through the REST interface', 'Page 1 of 1', 'Day Production version 3']) expect(raw).toContain(t);
    expect(masterSchedulePdfName(RECORD)).toBe('Day Production v3.pdf');
  });

  it('words value sources and ranges', () => {
    expect(valueSourceText({ value: '' })).toBe('(blank)');
    expect(valueSourceText({ from: 'trigger.output', name: 'Yield', fallback: '0' })).toBe('output "Yield" of the run that triggered it, else "0"');
    expect(valueSourceText({ from: 'occurrence.datetime' })).toBe('the occurrence date and time');
    expect(rangeText({ type: 'interval', every: 1, unit: 'hours', startAt: '2026-11-09T06:00' })).toBe('from 2026-11-09 06:00, with no end');
    expect(rangeText({ type: 'manual' })).toBe('');
  });
});
