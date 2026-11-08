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

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { RuntimeHistoryDetail } from '../../../lib/api/types';
import { pdfFileName } from './record-model';
import { downloadRecordPdf } from './download-record-pdf';

const fixture: RuntimeHistoryDetail = {
  id: 'h1', workflowInstanceId: null, workCenterId: 'wc', workCenterName: 'Line 1', runtimeNumber: 4, runtimeLabel: 'MIX-20261027-0004',
  masterName: 'Pizza Order', masterOid: 'm', masterVersion: '1.2.0', masterState: 'Effective', finalState: 'completed',
  startedAt: '2026-10-27T14:14:03Z', finishedAt: '2026-10-27T14:21:47Z', createdAt: '2026-10-27T14:14:03Z',
  startingParams: { Size: 'large' }, trace: [], properties: {}, stepParams: null,
  stepNames: {}, startedByLoginName: 'jdoe', startedByUserId: 'u1', userNames: {},
  createdByLabel: null, createdByInstanceId: null, outputs: [], controlEvents: [], stepRuns: [], signatures: [],
};

const save = vi.hoisted(() => vi.fn());
vi.mock('./record-pdf', () => ({ renderRecordPdf: () => ({ doc: { save } }) }));

describe('downloadRecordPdf', () => {
  afterEach(() => save.mockClear());

  it('saves the record once under its file name', async () => {
    await downloadRecordPdf(fixture, 'steward');
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(pdfFileName(fixture));
  });
});
