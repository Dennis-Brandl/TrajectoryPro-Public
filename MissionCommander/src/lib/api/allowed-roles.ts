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
import { get, put } from './client';
import type { AllowedRolesView } from './types';
// M6 dropped the /work-centers/:id segment: a workflow belongs to exactly one work center,
// so the segment named something the workflow id already determined. Two work centers
// holding the same oid are separate entries with separate assignments — that separation is
// enforced by the workflow id alone, and re-adding a work-center scope would undo it.
export const allowedRoles = {
  get: (workflowId: string) =>
    get(`/api/workflows/${workflowId}/allowed-roles`) as Promise<AllowedRolesView>,
  // The complete desired set, replacing whatever is stored. The dialog batches its edits
  // and commits them here in one atomic call.
  setRoles: (workflowId: string, nodes: { nodeId: string; roleIds: string[] }[]) =>
    put(`/api/workflows/${workflowId}/allowed-roles`, { nodes }) as Promise<AllowedRolesView>,
};
