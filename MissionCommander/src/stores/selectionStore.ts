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
import { create } from 'zustand';
// M6 retired the Libraries hierarchy: a work center already IS the execution set, so the
// library was an extra hop that earned nothing. Phase 7 Task 8 added 'history' as a sixth
// member: a cross-work-center page with no tree/selection of its own (HistoryPage owns its
// own filter/scope state), so it needs no `selectedHistoryId` companion field the way the
// other five members each have. The action-matching-mode spec (2026-08-20) adds 'settings' as
// a seventh member on the same footing as 'history': a single system-wide page (not scoped to
// any work center) with no tree/selection of its own (SettingsPanel owns its own load/save
// state), so it too needs no companion selected-id field. The Runtime pane spec (2026-08-27)
// adds 'runtime' as an eighth member: a true work-center tree (like work_center) whose leaves
// are active runtime workflows, so it DOES need its own companion selected-id field. The union
// is what HierarchyPane and DetailPanel switch over.
export type Hierarchy = 'work_center' | 'user' | 'workflow' | 'role' | 'environment' | 'runtime' | 'history' | 'settings';
type State = {
  activeHierarchy: Hierarchy;
  selectedWorkCenterId: string | null;
  selectedUserId: string | null;
  selectedRoleId: string | null;
  selectedWorkflowId: string | null;
  selectedEnvironmentId: string | null;
  selectedRuntimeWorkflowId: string | null;
  setHierarchy: (h: Hierarchy) => void;
  selectWorkCenter: (id: string | null) => void;
  selectUser: (id: string | null) => void;
  selectRole: (id: string | null) => void;
  selectWorkflow: (id: string | null) => void;
  selectEnvironment: (id: string | null) => void;
  selectRuntimeWorkflow: (id: string | null) => void;
};
export const useSelectionStore = create<State>((set) => ({
  activeHierarchy: 'work_center',
  selectedWorkCenterId: null,
  selectedUserId: null,
  selectedRoleId: null,
  selectedWorkflowId: null,
  selectedEnvironmentId: null,
  selectedRuntimeWorkflowId: null,
  setHierarchy: (activeHierarchy) => set({ activeHierarchy }),
  selectWorkCenter: (selectedWorkCenterId) => set({ selectedWorkCenterId }),
  selectUser: (selectedUserId) => set({ selectedUserId }),
  selectRole: (selectedRoleId) => set({ selectedRoleId }),
  selectWorkflow: (selectedWorkflowId) => set({ selectedWorkflowId }),
  selectEnvironment: (selectedEnvironmentId) => set({ selectedEnvironmentId }),
  selectRuntimeWorkflow: (selectedRuntimeWorkflowId) => set({ selectedRuntimeWorkflowId }),
}));
