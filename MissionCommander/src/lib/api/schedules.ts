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
import { get, post, put, del } from './client';
import type {
  ScheduleDefinition, Recurrence, MasterScheduleView, RuntimeScheduleView, RuntimeScheduleDetail,
  RuntimeScheduleStatus, OccurrencePage, ResumePreview, ResumeChoice, ResumeResult, EnablePreview,
  RecurrencePreview, RuntimeScheduleEventPage, ScheduleWorkflowOption, RunOncePreview, ScheduleClock, MasterScheduleRecord,
} from './types';

export type {
  ScheduleWorkflowOption,
  MasterScheduleView, RuntimeScheduleView, RuntimeScheduleDetail, ResumePreview, ResumeChoice, ResumeResult,
  EnablePreview, RecurrencePreview, OccurrencePage, RuntimeScheduleStatus, RuntimeScheduleEventPage,
} from './types';

// Spec 2026-11-08 §7. Reads need work_center:read; every write needs Administrator or the Mission
// System Commander flag on the schedule's work center (the server decides).
export const schedules = {
  // Master Schedules
  listMasters: (workCenterId: string) =>
    get(`/api/work-centers/${workCenterId}/master-schedules`) as Promise<MasterScheduleView[]>,
  getMaster: (id: string) => get(`/api/master-schedules/${id}`) as Promise<MasterScheduleView>,
  createMaster: (workCenterId: string, definition: ScheduleDefinition, changeReason: string) =>
    post(`/api/work-centers/${workCenterId}/master-schedules`, { ...definition, changeReason }) as Promise<MasterScheduleView>,
  /** Every edit records why, in the Master's change history. */
  replaceMaster: (id: string, definition: ScheduleDefinition, changeReason: string) =>
    put(`/api/master-schedules/${id}`, { ...definition, changeReason }) as Promise<MasterScheduleView>,
  /** The Master with its work center, zone and change history, for the Export PDF. */
  record: (id: string) => get(`/api/master-schedules/${id}/record`) as Promise<MasterScheduleRecord>,
  deleteMaster: (id: string) => del(`/api/master-schedules/${id}`) as Promise<undefined>,
  previewRecurrence: (workCenterId: string, recurrence: Recurrence) =>
    post(`/api/work-centers/${workCenterId}/recurrence-preview`, { recurrence }) as Promise<RecurrencePreview>,
  workflowOptions: (workCenterId: string) =>
    get(`/api/work-centers/${workCenterId}/schedule-workflows`) as Promise<ScheduleWorkflowOption[]>,
  previewEnable: (masterId: string) =>
    get(`/api/master-schedules/${masterId}/enable-preview`) as Promise<EnablePreview>,
  enable: (masterId: string) =>
    post(`/api/master-schedules/${masterId}/enable`) as Promise<{ runtime: RuntimeScheduleView; warnings: string[] }>,

  previewRunOnce: (masterId: string) =>
    get(`/api/master-schedules/${masterId}/run-once-preview`) as Promise<RunOncePreview>,
  /** With no `at` it starts now; `at` is YYYY-MM-DDTHH:mm in the work center's time zone. */
  runOnce: (masterId: string, at?: string) =>
    post(`/api/master-schedules/${masterId}/run-once`, at ? { at } : {}) as Promise<{ runtime: RuntimeScheduleView; warnings: string[] }>,
  clock: (workCenterId: string) => get(`/api/work-centers/${workCenterId}/schedule-clock`) as Promise<ScheduleClock>,

  // Runtime Schedules
  listRuntimes: (workCenterId: string, status?: RuntimeScheduleStatus) =>
    get(`/api/work-centers/${workCenterId}/runtime-schedules${status ? `?status=${status}` : ''}`) as Promise<RuntimeScheduleView[]>,
  getRuntime: (id: string) => get(`/api/runtime-schedules/${id}`) as Promise<RuntimeScheduleDetail>,
  occurrences: (id: string, page: { limit?: number; offset?: number } = {}) => {
    const q = new URLSearchParams();
    if (page.limit !== undefined) q.set('limit', String(page.limit));
    if (page.offset !== undefined) q.set('offset', String(page.offset));
    const s = q.toString();
    return get(`/api/runtime-schedules/${id}/occurrences${s ? `?${s}` : ''}`) as Promise<OccurrencePage>;
  },
  events: (id: string, page: { limit?: number; offset?: number } = {}) => {
    const q = new URLSearchParams();
    if (page.limit !== undefined) q.set('limit', String(page.limit));
    if (page.offset !== undefined) q.set('offset', String(page.offset));
    const s = q.toString();
    return get(`/api/runtime-schedules/${id}/events${s ? `?${s}` : ''}`) as Promise<RuntimeScheduleEventPage>;
  },
  resumePreview: (id: string) => get(`/api/runtime-schedules/${id}/resume-preview`) as Promise<ResumePreview>,
  pause: (id: string) => post(`/api/runtime-schedules/${id}/pause`) as Promise<undefined>,
  resume: (id: string, choice: ResumeChoice = {}) =>
    post(`/api/runtime-schedules/${id}/resume`, choice) as Promise<ResumeResult>,
  cancel: (id: string, reason: string) => post(`/api/runtime-schedules/${id}/cancel`, { reason }) as Promise<undefined>,
  remove: (id: string) => post(`/api/runtime-schedules/${id}/remove`) as Promise<undefined>,
  acknowledge: (id: string, runIds: string[] | 'all') =>
    post(`/api/runtime-schedules/${id}/acknowledge`, { runIds }) as Promise<{ dismissed: number }>,
  setItemDisabled: (id: string, itemId: string, disabled: boolean) =>
    put(`/api/runtime-schedules/${id}/items/${itemId}/disabled`, { disabled }) as Promise<undefined>,
};
