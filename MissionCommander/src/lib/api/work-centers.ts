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
import { get, post, patch, put, del } from './client';
import type { WcNode, WorkCenterView, SharedResourceView, SharedValuePropertyView, ResourceVerb, ResourceVerbBody, VerbResponse, WorkCenterThemeView } from './types';
import type { PilotTheme } from 'mission-control-db';
export type CreateWcInput = { name: string; parentWorkCenterId?: string | null; description?: string | null; sortOrder?: number; dispatchPolicy?: string; autoClaim?: boolean; runtimeIdTemplate?: string | null; typeName?: string | null };
export const workCenters = {
  list: () => get('/api/work-centers') as Promise<{ nodes: WcNode[] }>,
  get: (id: string) => get(`/api/work-centers/${id}`) as Promise<WorkCenterView>,
  create: (input: CreateWcInput) => post('/api/work-centers', input) as Promise<WorkCenterView>,
  update: (id: string, patchBody: Partial<CreateWcInput>) => patch(`/api/work-centers/${id}`, patchBody) as Promise<WorkCenterView>,
  // The two-call delete (spec §8.1): the first request never destroys anything, it 409s
  // with the impact summary the dialog renders (read off ApiError.body). Only
  // confirm=true performs the ordered teardown, and children refuse either way.
  remove: (id: string, confirm = false) =>
    del(`/api/work-centers/${id}${confirm ? '?confirm=true' : ''}`) as Promise<undefined>,
  // User assignment survived M6 — only ARTIFACT linking was retired. These moved off the
  // deleted links.ts onto the work center, which is what they were always scoped to.
  assignUser: (wcId: string, userId: string, opts?: { priority?: number; missionSystemCommander?: boolean }) =>
    post(`/api/work-centers/${wcId}/users/${userId}`, opts ?? {}) as Promise<WorkCenterView>,
  unassignUser: (wcId: string, userId: string) =>
    del(`/api/work-centers/${wcId}/users/${userId}`) as Promise<undefined>,
  // Spec 2026-09-06 D3: the whole desired role set for one member — the only role editor.
  setUserRoles: (wcId: string, userId: string, roleIds: string[]) =>
    put(`/api/work-centers/${wcId}/users/${userId}/roles`, { roleIds }) as Promise<WorkCenterView>,
  // Phase 3 (spec §6.4): the Shared State tab's two feeds — every registry row, orphans included.
  resources: (id: string) => get(`/api/work-centers/${id}/resources`) as Promise<{ resources: SharedResourceView[] }>,
  valueProperties: (id: string) => get(`/api/work-centers/${id}/value-properties`) as Promise<{ values: SharedValuePropertyView[] }>,
  // Phase 4b (spec §7.2): commander writes. The environment pane posts here too — it has no
  // writer of its own (an environment row IS a filtered view of work-center state).
  resourceVerb: (id: string, verb: ResourceVerb, body: ResourceVerbBody) =>
    post(`/api/work-centers/${id}/resources/${verb}`, body) as Promise<VerbResponse>,
  setValue: (id: string, body: { propertyName: string; entryName: string; value: string }) =>
    post(`/api/work-centers/${id}/value-properties`, body) as Promise<VerbResponse>,
  // Spec 2026-10-09 §8: the work center's Pilot theme override and the layers beneath it.
  pilotTheme: (id: string) => get(`/api/work-centers/${id}/pilot-theme`) as Promise<WorkCenterThemeView>,
  setPilotTheme: (id: string, pilotTheme: PilotTheme | null) =>
    put(`/api/work-centers/${id}/pilot-theme`, { pilotTheme }) as Promise<WorkCenterThemeView>,
};
