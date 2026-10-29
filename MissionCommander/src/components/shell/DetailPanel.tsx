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
import { useSelectionStore } from '@/stores/selectionStore';
import { WorkCenterDetail } from '@/components/work-center/WorkCenterDetail';
import { UserDetail } from '@/components/user/UserDetail';
import { RoleDetail } from '@/components/role/RoleDetail';
import { WorkflowDetail } from '@/components/workflow/WorkflowDetail';
import { EnvironmentDetail } from '@/components/environment/EnvironmentDetail';
import { HistoryPage } from '@/components/history/HistoryPage';
import { SettingsPanel } from '@/components/settings/SettingsPanel';
import { PilotBrandingEditor } from '@/components/settings/pilot-branding/PilotBrandingEditor';
import { RuntimeWorkflowDetail } from '@/components/runtime/RuntimeWorkflowDetail';

// Switches the central detail on the active hierarchy + its selection. Each detail
// component reads its own selected id from the store and owns its dialogs.
export function DetailPanel() {
  const activeHierarchy = useSelectionStore((s) => s.activeHierarchy);
  const selectedWorkCenterId = useSelectionStore((s) => s.selectedWorkCenterId);
  const selectedUserId = useSelectionStore((s) => s.selectedUserId);
  const selectedRoleId = useSelectionStore((s) => s.selectedRoleId);
  const selectedWorkflowId = useSelectionStore((s) => s.selectedWorkflowId);
  const selectedEnvironmentId = useSelectionStore((s) => s.selectedEnvironmentId);
  const selectedRuntimeWorkflowId = useSelectionStore((s) => s.selectedRuntimeWorkflowId);

  if (activeHierarchy === 'user') return selectedUserId ? <UserDetail /> : <div className="p-4 text-sm text-muted-foreground">Select a user</div>;
  if (activeHierarchy === 'role') return selectedRoleId ? <RoleDetail /> : <div className="p-4 text-sm text-muted-foreground">Select a role</div>;
  if (activeHierarchy === 'work_center') return selectedWorkCenterId ? <WorkCenterDetail /> : <div className="p-4 text-sm text-muted-foreground">Select a work center in the tree, or create one.</div>;
  if (activeHierarchy === 'workflow') return selectedWorkflowId ? <WorkflowDetail /> : <div className="p-4 text-sm text-muted-foreground">Select a workflow</div>;
  if (activeHierarchy === 'environment') return selectedEnvironmentId ? <EnvironmentDetail /> : <div className="p-4 text-sm text-muted-foreground">Select an environment</div>;
  // Runtime (spec 2026-08-27 §4.2/§4.3): RuntimeWorkflowDetail is store-driven (reads
  // selectedRuntimeWorkflowId itself) — this just gates on whether anything is selected.
  if (activeHierarchy === 'runtime') return selectedRuntimeWorkflowId ? <RuntimeWorkflowDetail /> : <div className="p-4 text-sm text-muted-foreground">Select a runtime workflow</div>;
  // History (Task 8) has no per-row selection to gate on — the page renders unconditionally,
  // owning its own filter/scope/pagination state (mirrors HistoryTab's per-work-center idiom).
  if (activeHierarchy === 'history') return <HistoryPage />;
  // Settings (action-matching-mode spec 2026-08-20) is system-wide, not scoped to any
  // selection — like History, it renders unconditionally and owns its own load/save state.
  // Pilot branding (spec 2026-10-09 §9) sits under the system settings, saved on its own.
  if (activeHierarchy === 'settings') return (<><SettingsPanel /><PilotBrandingEditor /></>);
  return null;
}
