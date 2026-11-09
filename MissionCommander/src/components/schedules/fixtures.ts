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
import type { RuntimeScheduleView, RuntimeScheduleDetail, RuntimeScheduleItemView, ResumePreview } from '@/lib/api/types';

// Test fixtures for the Schedules tab components.
export const view = (over: Partial<RuntimeScheduleView> = {}): RuntimeScheduleView => ({
  id: 'r1', label: 'RS-12', name: 'Line 1 Day Production', status: 'active',
  nextFireAt: '2026-11-09T15:00:00Z', timeZone: 'America/Chicago', masterScheduleId: 'm1', masterChanged: false, runOnce: false,
  needsAttention: { failed: 0, lost: 0, missedWindow: false }, ...over,
});

export const item = (over: Partial<RuntimeScheduleItemView> = {}): RuntimeScheduleItemView => ({
  id: 'i1', workflowId: 'wf1', masterName: 'Mix Batch', masterOid: 'o1', masterVersion: '1.0.0', masterState: 'effective',
  triggerOn: null, params: {}, disabled: false, disabledAt: null, newerVersionAvailable: false, children: [], ...over,
});

export const detail = (over: Partial<RuntimeScheduleDetail> = {}): RuntimeScheduleDetail => ({
  ...view(), workCenterId: 'w1', workCenterName: 'Assembly',
  recurrence: { pattern: 'daily', every: 1, times: ['06:00'] } as never, recurrenceText: 'Every day at 06:00',
  masterRevision: 1, missedFrom: null, missedTo: null, catchupMode: null,
  enabledAt: '2026-11-01T12:00:00Z', pausedAt: null, endedAt: null, items: [item()], ...over,
});

export const preview = (over: Partial<ResumePreview> = {}): ResumePreview => ({
  missedCount: 0, missedMore: false, missedFirst: null, missedLast: null, startAllAllowed: true, held: [], pausedAt: null, pausedBy: null, ...over,
});
