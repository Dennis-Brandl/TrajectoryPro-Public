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
import { get, patch, del } from './client';
import type { Workflow, WorkflowView, WorkflowDiagram } from './types';

// M6 reduced this to read + delete. `import`/`pull` moved to load.ts (one route now carries
// several packages of either kind into several work centers); `move` is gone with libraries;
// `linkWorkCenter`/`unlinkWorkCenter` are gone because loading IS the linking step.
export const workflows = {
  // Same endpoint as pickers.workflows(); named here so the Workflow hierarchy owns its
  // list (mirrors users.ts). One route deliberately serves both the tree and the
  // link-picker modal — it returns light summaries with no specJsonb, ordered by
  // (work center name, name, version, state).
  list: () => get('/api/workflows') as Promise<{ workflows: Workflow[] }>,
  get: (id: string) => get(`/api/workflows/${id}`) as Promise<WorkflowView>,
  diagram: (id: string) => get(`/api/workflows/${id}/diagram`) as Promise<WorkflowDiagram>,
  remove: (id: string) => del(`/api/workflows/${id}`) as Promise<undefined>, // server returns 204
};

// Phase 4a (spec 2026-08-03 §6): sets/clears a workflow's dispatch-policy override.
// `policy: null` means "inherit the owning work center's default" — see
// setWorkflowDispatchPolicy (mission-control-db/src/dao/workflows.ts).
export function patchWorkflowDispatchPolicy(id: string, policy: string | null): Promise<void> {
  return patch(`/api/workflows/${id}/dispatch-policy`, { policy }) as Promise<void>;
}

// Auto-claim override (spec 2026-08-14 D4). `value: null` = inherit the work center's setting.
export function patchWorkflowAutoClaim(id: string, value: boolean | null): Promise<void> {
  return patch(`/api/workflows/${id}/auto-claim`, { value }) as Promise<void>;
}
