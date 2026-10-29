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
import { get, post, del } from './client';
import type {
  RuntimeWorkflowSummary, RuntimeParameterSpec, RuntimeListFilter,
  RuntimeWorkflowPage, RuntimeWorkflowLiveDetail, WorkCenterPresenceEntry,
  RuntimeActiveTree, RuntimeWorkflowDiagram, RuntimeWorkflowLiveStates, AssignmentCandidatesView,
  InstanceResourcesView, InstanceValuePropertiesView, ResourceVerb, InstanceResourceVerbBody, VerbResponse,
  CreatedRuntimesPage,
} from './types';

export const runtimeWorkflows = {
  parameters: (workflowId: string) => get(`/api/workflows/${workflowId}/runtime-parameters`) as Promise<{ workflowId: string; parameters: RuntimeParameterSpec[] }>,
  create: (workflowId: string, params: Record<string, string>, opts: { start: boolean }) =>
    post(`/api/workflows/${workflowId}/runtime-workflows`, { params, start: opts.start }) as Promise<RuntimeWorkflowSummary>,
  list: (workCenterId: string, opts: { filter: RuntimeListFilter; page: number }) =>
    get(`/api/work-centers/${workCenterId}/runtime-workflows?filter=${opts.filter}&page=${opts.page}`) as Promise<RuntimeWorkflowPage>,
  live: (id: string) => get(`/api/runtime-workflows/${id}/live`) as Promise<RuntimeWorkflowLiveDetail>,
  presence: (workCenterId: string) => get(`/api/work-centers/${workCenterId}/presence`) as Promise<{ presence: WorkCenterPresenceEntry[] }>,
  start: (id: string) => post(`/api/runtime-workflows/${id}/start`, {}) as Promise<RuntimeWorkflowSummary>,
  pause: (id: string) => post(`/api/runtime-workflows/${id}/pause`, {}) as Promise<{ ok: true }>,
  resume: (id: string) => post(`/api/runtime-workflows/${id}/resume`, {}) as Promise<{ ok: true }>,
  stop: (id: string) => post(`/api/runtime-workflows/${id}/stop`, {}) as Promise<{ ok: true }>,
  abort: (id: string) => post(`/api/runtime-workflows/${id}/abort`, {}) as Promise<{ ok: true }>,
  forceRelease: (assignmentId: string) => post(`/api/assignments/${assignmentId}/force-release`, {}) as Promise<{ ok: true }>,
  remove: (id: string) => del(`/api/runtime-workflows/${id}`) as Promise<undefined>,
  activeTree: () => get('/api/runtime-workflows/active') as Promise<RuntimeActiveTree>,
  diagram: (id: string) => get(`/api/runtime-workflows/${id}/diagram`) as Promise<RuntimeWorkflowDiagram>,
  liveStates: (id: string) => get(`/api/runtime-workflows/${id}/live-states`) as Promise<RuntimeWorkflowLiveStates>,
  candidates: (assignmentId: string) => get(`/api/assignments/${assignmentId}/candidates`) as Promise<AssignmentCandidatesView>,
  assign: (assignmentId: string, userId: string) => post(`/api/assignments/${assignmentId}/assign`, { userId }) as Promise<{ ok: true }>,
  // Phase 3 (spec §6.5): the Runtime pane's two shared-state sections.
  resources: (id: string) => get(`/api/runtime-workflows/${id}/resources`) as Promise<InstanceResourcesView>,
  valueProperties: (id: string) => get(`/api/runtime-workflows/${id}/value-properties`) as Promise<InstanceValuePropertiesView>,
  // Phase 4b (spec §7.2): this instance's OWN pools and stores. Environment rows go through
  // workCenters.resourceVerb / setValue (spec §12.5 item 23; D17).
  resourceVerb: (id: string, verb: ResourceVerb, body: InstanceResourceVerbBody) =>
    post(`/api/runtime-workflows/${id}/resources/${verb}`, body) as Promise<VerbResponse>,
  setValue: (id: string, body: { specOid?: string; key: string; value: string }) =>
    post(`/api/runtime-workflows/${id}/value-properties`, body) as Promise<VerbResponse>,
  // Spec 2026-10-19 §A: the runtimes this one created.
  children: (id: string) => get(`/api/runtime-workflows/${id}/children`) as Promise<CreatedRuntimesPage>,
  // Spec 2026-10-13 §5.2.
  forceComplete: (id: string, stepInstanceId: string, reason: string) =>
    post(`/api/runtime-workflows/${id}/steps/${stepInstanceId}/force-complete`, { reason }) as Promise<VerbResponse>,
};
