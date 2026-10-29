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
import { useState } from 'react';
import { useSelectionStore } from '@/stores/selectionStore';
import { WorkCenterTree, refreshTree } from '@/components/work-center/WorkCenterTree';
import { WorkCenterDialog } from '@/components/work-center/WorkCenterDialog';
import { UserTree, refreshUserTree } from '@/components/user/UserTree';
import { RoleTree, refreshRoleTree } from '@/components/role/RoleTree';
import { UserDialog } from '@/components/user/UserDialog';
import { RoleDialog } from '@/components/role/RoleDialog';
import { WorkflowTree } from '@/components/workflow/WorkflowTree';
import { EnvironmentTree } from '@/components/environment/EnvironmentTree';
import { RuntimeWorkflowTree } from '@/components/runtime/RuntimeWorkflowTree';

// Owns the create dialogs for each hierarchy's tree "＋" affordance. WC create dialog
// (M1) plus the new user/role create dialogs (Tasks 5/8): on create, refresh the tree
// and select the new entity so its detail hook refetches.
export function HierarchyPane() {
  const activeHierarchy = useSelectionStore((s) => s.activeHierarchy);
  const selectWorkCenter = useSelectionStore((s) => s.selectWorkCenter);
  const selectUser = useSelectionStore((s) => s.selectUser);
  const selectRole = useSelectionStore((s) => s.selectRole);
  const [wcCreate, setWcCreate] = useState<{ open: boolean; parentWorkCenterId: string | null }>({ open: false, parentWorkCenterId: null });
  const [userCreateOpen, setUserCreateOpen] = useState(false);
  const [roleCreateOpen, setRoleCreateOpen] = useState(false);

  if (activeHierarchy === 'user') {
    return (
      <>
        <UserTree onCreateUser={() => setUserCreateOpen(true)} />
        <UserDialog open={userCreateOpen} onOpenChange={setUserCreateOpen}
          onSaved={(v) => { refreshUserTree(); selectUser(v.user.id); }} />
      </>
    );
  }
  if (activeHierarchy === 'role') {
    return (
      <>
        <RoleTree onCreateRole={() => setRoleCreateOpen(true)} />
        <RoleDialog open={roleCreateOpen} onOpenChange={setRoleCreateOpen} initial={null}
          onSaved={(v) => { refreshRoleTree(); selectRole(v.role.id); }} />
      </>
    );
  }
  // Both artifact trees are read-only listings needing no create-dialog wiring, unlike the
  // work-center/user/role trees above. M6 moved loading onto WorkCenterDetail, so they no
  // longer own header controls of their own either.
  if (activeHierarchy === 'workflow') return <WorkflowTree />;
  if (activeHierarchy === 'environment') return <EnvironmentTree />;
  // Runtime (spec 2026-08-27 §4.2): a true WC tree with active runtime-workflow leaves.
  if (activeHierarchy === 'runtime') return <RuntimeWorkflowTree />;
  // History (Task 8) is a cross-work-center page, not a tree — there is nothing to select
  // here, so the pane is a short caption; the real content lives in DetailPanel's HistoryPage.
  if (activeHierarchy === 'history') {
    return <p className="p-4 text-sm text-muted-foreground">Execution history across all work centers</p>;
  }
  // Settings (action-matching-mode spec 2026-08-20) is system-wide, not scoped to any work
  // center — like History, there is nothing to select here; the real content lives in
  // DetailPanel's SettingsPanel.
  if (activeHierarchy === 'settings') {
    return <p className="p-4 text-sm text-muted-foreground">System-wide configuration</p>;
  }
  if (activeHierarchy !== 'work_center') return null;

  return (
    <>
      <WorkCenterTree
        onCreateRoot={() => setWcCreate({ open: true, parentWorkCenterId: null })}
        onCreateChild={(parentId) => setWcCreate({ open: true, parentWorkCenterId: parentId })}
      />
      <WorkCenterDialog open={wcCreate.open} onOpenChange={(open) => setWcCreate((s) => ({ ...s, open }))}
        initial={null} parentWorkCenterId={wcCreate.parentWorkCenterId}
        onSaved={(v) => { refreshTree(); selectWorkCenter(v.workCenter.id); }} />
    </>
  );
}
