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
import { useCallback, useState } from 'react';
import { useSelectionStore } from '@/stores/selectionStore';
import { useHasRight } from '@/stores/principalStore';
import { useResourceView } from '@/lib/hooks/useResourceView';
import { roles } from '@/lib/api/roles';
import type { RoleView } from '@/lib/api/types';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RefreshErrorBanner } from '@/components/shell/RefreshErrorBanner';
import { RequiresTooltip } from '@/components/shared/RequiresTooltip';
import { RoleDialog } from './RoleDialog';
import { DeleteRoleDialog } from './DeleteRoleDialog';
import { refreshRoleTree } from './RoleTree';

export function RoleDetail() {
  const selectedRoleId = useSelectionStore((s) => s.selectedRoleId);
  const selectRole = useSelectionStore((s) => s.selectRole);
  const fetch = useCallback((id: string) => roles.get(id), []);
  const { view, loading, error, setView } = useResourceView<RoleView>(selectedRoleId, fetch, 'Failed to load role');
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const canEdit = useHasRight('role:edit');
  const canDelete = useHasRight('role:delete');

  if (loading && !view) return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;
  // Only take the full-panel slot when there's no stale view to fall back to; a
  // failed same-id refresh() keeps its stale view mounted (useResourceView), so that
  // case falls through to the banner rendered below instead.
  if (error && !view) return <div className="p-4 text-sm text-destructive">Failed to load role</div>;
  if (!view) return null;

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      {error && <RefreshErrorBanner />}
      <div className="space-y-1">
        <div className="text-sm text-muted-foreground">Roles ›</div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">{view.role.name}</h1>
            {view.role.description && <p className="text-sm text-muted-foreground">{view.role.description}</p>}
          </div>
          <div className="flex gap-2">
            <RequiresTooltip reason={canEdit ? undefined : 'Requires role:edit'}>
              <Button type="button" variant="outline" size="sm" onClick={() => setEditOpen(true)}
                disabled={!canEdit} title={canEdit ? undefined : 'Requires role:edit'}>Edit</Button>
            </RequiresTooltip>
            <RequiresTooltip reason={canDelete ? undefined : 'Requires role:delete'}>
              <Button type="button" variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}
                disabled={!canDelete} title={canDelete ? undefined : 'Requires role:delete'}>Delete</Button>
            </RequiresTooltip>
          </div>
        </div>
      </div>

      <RoleDialog open={editOpen} onOpenChange={setEditOpen} initial={view.role}
        onSaved={(v) => { setView(v); refreshRoleTree(); }} />

      <DeleteRoleDialog open={deleteOpen} onOpenChange={setDeleteOpen} role={view.role}
        onDeleted={() => { refreshRoleTree(); selectRole(null); }} />

      {/* Spec 2026-09-06 D3: roles are held per work center and assigned from the work center's
          Users tab, so this side is an audit view — who holds the role, and where. */}
      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="workflows">Workflows</TabsTrigger>
        </TabsList>
        <TabsContent value="users">
          {view.members.length === 0 ? <p className="text-sm text-muted-foreground">No members</p> : (
            <Table>
              <TableHeader><TableRow><TableHead>Work center</TableHead><TableHead>Members</TableHead></TableRow></TableHeader>
              <TableBody>
                {view.members.map((m) => (
                  <TableRow key={m.workCenter.id}>
                    <TableCell>{m.workCenter.name}</TableCell>
                    <TableCell>{m.users.map((u) => `${u.displayName} (${u.loginName})`).join(', ')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <p className="mt-2 text-xs text-muted-foreground">Roles are assigned to users from the work center.</p>
        </TabsContent>
        <TabsContent value="workflows">
          {view.workflows.length === 0 ? <p className="text-sm text-muted-foreground">Not used by any workflow</p> : (
            <Table>
              <TableHeader><TableRow><TableHead>Workflow</TableHead><TableHead>Version</TableHead></TableRow></TableHeader>
              <TableBody>
                {view.workflows.map((w) => (<TableRow key={w.id}><TableCell>{w.name}</TableCell><TableCell>{w.version}</TableCell></TableRow>))}
              </TableBody>
            </Table>
          )}
          <p className="mt-2 text-xs text-muted-foreground">Where this role is assigned (allowed-role audit). Read-only.</p>
        </TabsContent>
      </Tabs>
    </div>
  );
}
