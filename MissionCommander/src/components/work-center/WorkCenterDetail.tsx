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
import { useCallback, useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useSelectionStore } from '@/stores/selectionStore';
import { useHasRight, useMissionSystemCommander, usePrincipalStore } from '@/stores/principalStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { workCenters } from '@/lib/api/work-centers';
import { workflows } from '@/lib/api/workflows';
import { pickers } from '@/lib/api/pickers';
import { environmentBindings } from '@/lib/api/environment-bindings';
import { systemSettings } from '@/lib/api/system-settings';
import { apiErrorMessage } from '@/lib/api/client';
import type { ActionServerTrust, EnvironmentBinding, EnvironmentSpec, LoadResult, Role, Workflow, WorkCenterMember, WorkCenterView, WorkflowWithRoleCount } from '@/lib/api/types';
import { useWorkCenterView } from './useWorkCenterView';
import { WorkCenterDialog } from './WorkCenterDialog';
import { DeleteWorkCenterDialog } from './DeleteWorkCenterDialog';
import { LinkPickerModal } from './LinkPickerModal';
import { AllowedRolesDialog } from './AllowedRolesDialog';
import { WorkCenterUserRolesDialog } from './WorkCenterUserRolesDialog';
import { UnassignUserDialog } from './UnassignUserDialog';
import { LoadDialog } from './LoadDialog';
import { LoadResultsDialog } from './LoadResultsDialog';
import { SavePackageDialog } from './SavePackageDialog';
import { WorkCenterBrandingTab } from './WorkCenterBrandingTab';
import { ControlGrantsTab } from './ControlGrantsTab';
import { refreshTree } from './WorkCenterTree';
import { refreshWorkflowTree } from '@/components/workflow/WorkflowTree';
import { RefreshErrorBanner } from '@/components/shell/RefreshErrorBanner';
import { StateBadge } from '@/components/artifact/StateBadge';
import { DeleteSpecDialog } from '@/components/shared/DeleteSpecDialog';
import { RequiresTooltip } from '@/components/shared/RequiresTooltip';
import { CreateRuntimeWorkflowDialog } from '@/components/runtime/CreateRuntimeWorkflowDialog';
import { RuntimeTab } from '@/components/runtime/RuntimeTab';
import { HistoryTab } from '@/components/history/HistoryTab';
import { SharedStateTab } from './SharedStateTab';

// P3 review fix: mirrors WorkCenterTree.tsx's own refreshTree() module-level handler so a
// caller OUTSIDE this component's subtree (WorkCenterTree owns the import dialog, and a
// confirmed import must refresh both panes — see onImported in WorkCenterTree.tsx) can force
// a re-fetch of whichever work center is currently selected, with no provider wiring required.
let refreshHandler: (() => void) | null = null;
export function refreshDetail() {
  refreshHandler?.();
}

// This view owns its edit/delete dialogs AND the Load flow: every mutation
// handler lives here, in scope of view/setView/refresh, so callers just mount
// <WorkCenterDetail /> with no props.
//
// M6 removed the artifact link-pickers entirely — loading IS the linking step now, so the
// Workflows and Env Specs tabs are read-only listings of what this work center owns. USER
// assignment survived and keeps its picker.
export function WorkCenterDetail() {
  const selectedWorkCenterId = useSelectionStore((s) => s.selectedWorkCenterId);
  const selectWorkCenter = useSelectionStore((s) => s.selectWorkCenter);
  const { view, loading, error, refresh, setView } = useWorkCenterView(selectedWorkCenterId);
  // Registers this render's `refresh` (stable per selected id — useResourceView keys it on
  // `[id]`) as the module-level handler refreshDetail() invokes. Placed with the rest of this
  // component's hooks, above the early returns below, so hook call order stays stable across
  // every render path (same rule the canX consts further down already follow).
  useEffect(() => {
    refreshHandler = refresh;
    return () => { refreshHandler = null; };
  }, [refresh]);
  const [editOpen, setEditOpen] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [userPickerOpen, setUserPickerOpen] = useState(false);
  const [loadOpen, setLoadOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [loadResults, setLoadResults] = useState<LoadResult[] | null>(null);
  const [loadNames, setLoadNames] = useState<Record<string, string>>({});
  const [allowedRolesFor, setAllowedRolesFor] = useState<{ workflowId: string; workflowName: string } | null>(null);
  const [runtimeFor, setRuntimeFor] = useState<Workflow | null>(null);
  const [deleteWorkflowFor, setDeleteWorkflowFor] = useState<Workflow | null>(null);
  const [rolesFor, setRolesFor] = useState<WorkCenterMember | null>(null);
  const [pendingUnassign, setPendingUnassign] = useState<WorkCenterMember | null>(null);

  // Stable identity (empty deps) so LinkPickerModal's fetch-on-open effect only re-fires
  // when `open` actually flips, not on every WorkCenterDetail re-render while the modal
  // happens to be open (e.g. right after an assign's setView).
  const fetchUsers = useCallback(
    () => pickers.users().then((r) => r.users.map((u) => ({ id: u.id, name: u.displayName }))),
    [],
  );

  // Display-only capability gating: the server re-authorizes every mutation, so these only
  // drive disabled+title on the controls below — a Viewer sees a fully read-only tool,
  // never a blank one. Computed above the early returns (with the rest of this component's
  // hooks) so hook call order stays stable across every render path.
  const canEdit = useHasRight('work_center:edit');
  const canDelete = useHasRight('work_center:delete');
  // The Load route requires workflow:create AND environment:create, but every access tier
  // that holds one holds the other (dao/access.ts TIER_RIGHTS), so gating the button on one
  // can never hide it from a steward who could legitimately load.
  const canLoad = useHasRight('workflow:create');

  // Gate on "loading AND nothing to show": the initial fetch and every id change (the hook
  // nulls the view on id change) show the loading slot, but an imperative same-id refresh()
  // keeps the current (stale) view mounted while revalidating, so the uncontrolled <Tabs>
  // below never unmounts and the active tab survives the refetch.
  if (loading && !view) return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;
  // The specific server message was already surfaced via toast when the hook set this error,
  // so the inline slot only needs a generic, persistent indicator. Only take the full-panel
  // slot when there's no stale view to fall back to.
  if (error && !view) return <div className="p-4 text-sm text-destructive">Failed to load work center</div>;
  if (!view) return null;

  // A result that arrives after the user switched work centers must not touch the one on screen:
  // setView would replace B's view with A's and cancel B's in-flight load.
  const shownId = view.workCenter.id;
  const stillSelected = (id: string) => useSelectionStore.getState().selectedWorkCenterId === id;

  // User assignment: assign returns the already-fresh view; unassign is a 204, so it
  // explicitly refresh()es instead. Neither affects the work-center tree.
  const handleAssign = async (request: Promise<WorkCenterView>) => {
    const wcId = view.workCenter.id;
    try {
      const next = await request;
      if (!stillSelected(wcId)) return; // the user moved to another work center: drop this result
      setView(next);
      toast.success('Assigned');
      setUserPickerOpen(false); // single-assign-per-open flow: close only on success
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Assign failed')); // stays open — user can retry
    }
  };

  // Rejects on failure: UnassignUserDialog toasts it and stays open.
  const handleUnassign = async (userId: string) => {
    const wcId = view.workCenter.id;
    await workCenters.unassignUser(wcId, userId);
    if (stillSelected(wcId)) refresh();
    toast.success('Unassigned');
  };

  const handleToggleSystemCommander = async (userId: string, next: boolean) => {
    const wcId = view.workCenter.id;
    try {
      const updated = await workCenters.assignUser(wcId, userId, { missionSystemCommander: next });
      if (stillSelected(wcId)) setView(updated);
      toast.success(next ? 'Mission System Commander granted' : 'Mission System Commander revoked');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Update failed'));
    }
  };

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      {error && <RefreshErrorBanner />}
      <div className="space-y-1">
        <div className="text-sm text-muted-foreground">Work Centers ›</div>
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-xl font-semibold">{view.workCenter.name}</h1>
          <div className="flex gap-2">
            <RequiresTooltip reason={canLoad ? undefined : 'Requires workflow:create'}>
              <Button type="button" size="sm" onClick={() => setLoadOpen(true)}
                disabled={!canLoad} title={canLoad ? undefined : 'Requires workflow:create'}>Load packages…</Button>
            </RequiresTooltip>
            <Button type="button" variant="outline" size="sm" onClick={() => setSaveOpen(true)}>
              Save package…
            </Button>
            <RequiresTooltip reason={canEdit ? undefined : 'Requires work_center:edit'}>
              <Button type="button" variant="outline" size="sm" onClick={() => setEditOpen(true)}
                disabled={!canEdit} title={canEdit ? undefined : 'Requires work_center:edit'}>Edit</Button>
            </RequiresTooltip>

            <RequiresTooltip reason={canDelete ? undefined : 'Requires work_center:delete'}>
              <Button type="button" variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}
                disabled={!canDelete} title={canDelete ? undefined : 'Requires work_center:delete'}>Delete</Button>
            </RequiresTooltip>
          </div>
        </div>
        {/* 2026-08-17 user feedback: these settings lived ONLY inside the Edit dialog. Shown
            read-only here so they are discoverable; editing stays in the dialog. */}
        {view.workCenter.typeName && (
          <div className="text-sm text-muted-foreground">
            Type:{' '}
            <span className="font-medium text-foreground">{view.workCenter.typeName}</span>
          </div>
        )}
        <div className="text-sm text-muted-foreground">
          Dispatch policy:{' '}
          <span className="font-medium text-foreground">{view.workCenter.dispatchPolicy}</span>
          <span className="mx-2">·</span>
          Auto-claim follow-on steps:{' '}
          <span className="font-medium text-foreground">{view.workCenter.autoClaim ? 'On' : 'Off'}</span>
        </div>
        <div className="text-sm text-muted-foreground">
          Runtime ID format:{' '}
          <span className="font-medium text-foreground">{view.workCenter.runtimeIdTemplate ?? 'RW-n (default)'}</span>
        </div>
      </div>
      {/* Edit: names/nesting may change, so refresh the tree; drop the returned
          (already-fresh) view straight into the token-protected setter. */}
      <WorkCenterDialog
        open={editOpen} onOpenChange={setEditOpen}
        initial={view.workCenter} parentWorkCenterId={view.workCenter.parentWorkCenterId}
        onSaved={(v) => { refreshTree(); if (stillSelected(v.workCenter.id)) setView(v); }}
      />
      {/* Child work centers are created from the tree row's ＋ ("New child of {name}",
          WorkCenterTree.tsx); the duplicate "New Child" button that lived here was removed
          2026-09-09 (user feedback: two controls for one action was confusing). */}
      <DeleteWorkCenterDialog
        open={deleteOpen} onOpenChange={setDeleteOpen}
        workCenter={view.workCenter}
        onDeleted={() => { refreshTree(); selectWorkCenter(null); }}
      />
      <LoadDialog
        open={loadOpen} onOpenChange={setLoadOpen}
        workCenterId={view.workCenter.id} workCenterName={view.workCenter.name}
        onLoaded={(results, names) => {
          setLoadNames(names);
          setLoadResults(results);
          // Both panes can change: this work center gained entries, and the tree renders
          // artifact leaves for every work center the fan-out touched.
          if (stillSelected(shownId)) refresh();
          refreshTree();
        }}
      />
      <LoadResultsDialog
        results={loadResults} workCenterNames={loadNames}
        onClose={() => setLoadResults(null)}
      />
      <SavePackageDialog
        open={saveOpen} onOpenChange={setSaveOpen}
        workCenterId={view.workCenter.id} workCenterName={view.workCenter.name}
      />
      <LinkPickerModal
        open={userPickerOpen}
        onOpenChange={setUserPickerOpen}
        title="Add user"
        fetchItems={fetchUsers}
        linkedIds={new Set(view.users.map((u) => u.id))}
        onLink={(id) => handleAssign(workCenters.assignUser(view.workCenter.id, id))}
      />
      {allowedRolesFor && (
        <AllowedRolesDialog
          open onOpenChange={(o) => { if (!o) setAllowedRolesFor(null); }}
          workflowId={allowedRolesFor.workflowId}
          workflowName={allowedRolesFor.workflowName}
          onClosed={() => { setAllowedRolesFor(null); if (stillSelected(shownId)) refresh(); }}
        />
      )}
      {rolesFor && (
        <WorkCenterUserRolesDialog
          open onOpenChange={(o) => { if (!o) setRolesFor(null); }}
          workCenterId={view.workCenter.id}
          member={rolesFor}
          onSaved={(v) => { if (stillSelected(v.workCenter.id)) setView(v); setRolesFor(null); }}
        />
      )}
      {pendingUnassign && (
        <UnassignUserDialog
          open onOpenChange={(o) => { if (!o) setPendingUnassign(null); }}
          userName={pendingUnassign.displayName} workCenterName={view.workCenter.name}
          roleNames={pendingUnassign.roles.map((r) => r.name)}
          onConfirm={async () => { await handleUnassign(pendingUnassign.id); setPendingUnassign(null); }}
        />
      )}
      {runtimeFor && (
        <CreateRuntimeWorkflowDialog
          open onOpenChange={(o) => { if (!o) setRuntimeFor(null); }}
          workflowId={runtimeFor.id} workflowName={runtimeFor.name}
          workflowVersion={runtimeFor.version} workflowState={runtimeFor.state}
          onCreated={() => setRuntimeFor(null)}
        />
      )}
      {deleteWorkflowFor && (
        <DeleteSpecDialog
          open onOpenChange={(o) => { if (!o) setDeleteWorkflowFor(null); }}
          kind="workflow" name={deleteWorkflowFor.name}
          onConfirm={() => workflows.remove(deleteWorkflowFor.id)}
          onDeleted={() => {
            // Same post-delete wiring as WorkflowDetail's header Delete, plus a refresh of
            // THIS view so the row disappears. A stale Workflows-hierarchy selection pointing
            // at the deleted spec would 404 on its next fetch — clear it, leave others alone.
            refreshWorkflowTree();
            if (useSelectionStore.getState().selectedWorkflowId === deleteWorkflowFor.id) {
              useSelectionStore.getState().selectWorkflow(null);
            }
            setDeleteWorkflowFor(null);
            if (stillSelected(shownId)) refresh();
          }}
        />
      )}
      <Tabs key={view.workCenter.id} defaultValue="workflows">
        <TabsList>
          <TabsTrigger value="workflows">Workflows</TabsTrigger>
          <TabsTrigger value="environments">Env Specs</TabsTrigger>
          <TabsTrigger value="runtime">Runtime</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="shared">Env Resources</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="roles">Roles</TabsTrigger>
          <TabsTrigger value="branding">Branding</TabsTrigger>
          <TabsTrigger value="control">Controls</TabsTrigger>
        </TabsList>
        <TabsContent value="workflows">
          <WorkflowsTab
            workflows={view.workflows}
            workCenterId={view.workCenter.id}
            onEditRoles={(wf) => setAllowedRolesFor({ workflowId: wf.id, workflowName: wf.name })}
            onCreateRuntime={(wf) => setRuntimeFor(wf)}
            onDelete={(wf) => setDeleteWorkflowFor(wf)}
          />
        </TabsContent>
        <TabsContent value="users">
          <UsersTab
            users={view.users}
            onAssign={() => setUserPickerOpen(true)}
            onUnassign={setPendingUnassign}
            onToggleSystemCommander={handleToggleSystemCommander}
            onEditRoles={(u) => setRolesFor(u)}
          />
        </TabsContent>
        <TabsContent value="environments">
          <EnvironmentsTab environments={view.environments} workCenterId={view.workCenter.id} />
        </TabsContent>
        <TabsContent value="roles">
          <RolesTab roles={view.roles} />
        </TabsContent>
        <TabsContent value="runtime">
          <RuntimeTab workCenterId={view.workCenter.id} />
        </TabsContent>
        <TabsContent value="history">
          <HistoryTab workCenterId={view.workCenter.id} />
        </TabsContent>
        <TabsContent value="shared">
          <SharedStateTab workCenterId={view.workCenter.id} />
        </TabsContent>
        <TabsContent value="branding">
          <WorkCenterBrandingTab workCenterId={view.workCenter.id} />
        </TabsContent>
        <TabsContent value="control">
          <ControlGrantsTab workCenterId={view.workCenter.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * Read-only listing of the workflows loaded into this work center.
 *
 * No link/unlink: loading is the linking step, and an entry is removed from its own detail
 * panel. No dispatch editor either — workflow.dispatch_policy lost its only DAO writer when
 * M6 deleted the link DAO, so a control here would PATCH a route that does not exist.
 */
function WorkflowsTab({ workflows, workCenterId, onEditRoles, onCreateRuntime, onDelete }:
  { workflows: WorkflowWithRoleCount[]; workCenterId: string; onEditRoles: (wf: Workflow) => void; onCreateRuntime: (wf: Workflow) => void; onDelete: (wf: Workflow) => void }) {
  const canEditRoles = useHasRight('work_center:link');
  const canDelete = useHasRight('workflow:delete');
  // Runtime workflows are dispatch operations gated on Mission System Commander, not any static
  // access-tier right — a Viewer who happens to be Commander of THIS work center can still
  // start work here. Computed above the early return below so hook order stays stable.
  const canCommand = useMissionSystemCommander(workCenterId);
  if (workflows.length === 0) return <p className="text-sm text-muted-foreground">No workflows loaded</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Version</TableHead>
          <TableHead>State</TableHead>
          <TableHead className="text-right">Roles</TableHead>
          <TableHead><span className="sr-only">Actions</span></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {workflows.map((wf) => (
          <TableRow key={wf.id}>
            <TableCell>{wf.name}</TableCell>
            <TableCell>{wf.version}</TableCell>
            <TableCell><StateBadge state={wf.state} effectiveFrom={wf.effectiveFrom} /></TableCell>
            {/* Distinct roles that may act anywhere in this workflow — a role granted on
                several steps counts once. Rendered as a literal 0 rather than a dash so the
                column reads as a count, not as "unknown". */}
            <TableCell className="text-right tabular-nums">{wf.allowedRoleCount}</TableCell>
            <TableCell>
              {/* variant="outline", not ghost (2026-08-10 user-testing ticket): ghost rendered
                  these as bare text, hiding that the row even has actions until hover. */}
              <RequiresTooltip reason={canEditRoles ? undefined : 'Requires work_center:link'}>
                <Button type="button" variant="outline" size="sm" aria-label={`Roles for ${wf.name}`}
                  onClick={() => onEditRoles(wf)} disabled={!canEditRoles}
                  title={canEditRoles ? undefined : 'Requires work_center:link'}>Roles…</Button>
              </RequiresTooltip>
              <RequiresTooltip reason={canCommand ? undefined : 'Requires Mission System Commander'}>
                <Button type="button" variant="outline" size="sm" className="ml-2" aria-label={`Create runtime workflow from ${wf.name}`}
                  onClick={() => onCreateRuntime(wf)} disabled={!canCommand}
                  title={canCommand ? undefined : 'Requires Mission System Commander'}>Create Runtime Workflow…</Button>
              </RequiresTooltip>
              <RequiresTooltip reason={canDelete ? undefined : 'Requires workflow:delete'}>
                <Button type="button" variant="outline" size="sm" className="ml-2 text-destructive" aria-label={`Delete ${wf.name}`}
                  onClick={() => onDelete(wf)} disabled={!canDelete}
                  title={canDelete ? undefined : 'Requires workflow:delete'}><Trash2 className="size-4" /></Button>
              </RequiresTooltip>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// The one tab that kept its picker: M6 retired ARTIFACT linking, not user assignment.
// Spec 2026-09-06 D3: it is also the ONLY place roles are assigned — per member, per work
// center — so the row carries the roles held here beside the Mission System Commander flag.
function UsersTab({ users, onAssign, onUnassign, onToggleSystemCommander, onEditRoles }: {
  users: WorkCenterMember[];
  onAssign: () => void;
  onUnassign: (user: WorkCenterMember) => void;
  onToggleSystemCommander: (userId: string, next: boolean) => void;
  onEditRoles: (member: WorkCenterMember) => void;
}) {
  const canLink = useHasRight('work_center:link');
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <RequiresTooltip reason={canLink ? undefined : 'Requires work_center:link'}>
          <Button type="button" variant="outline" size="sm" aria-label="Add user" onClick={onAssign}
            disabled={!canLink} title={canLink ? undefined : 'Requires work_center:link'}>＋ Add User</Button>
        </RequiresTooltip>
      </div>
      {users.length === 0 ? (
        <p className="text-sm text-muted-foreground">No assigned users</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Login</TableHead>
              <TableHead>Roles</TableHead>
              <TableHead>Access Level</TableHead>
              <TableHead>Mission System Commander</TableHead>
              <TableHead><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.id}>
                <TableCell>
                  <div>{u.displayName}</div>
                  <div className="text-xs text-muted-foreground">{u.email}</div>
                </TableCell>
                <TableCell className="font-mono text-xs">{u.loginName}</TableCell>
                <TableCell>
                  <span>{u.roles.length ? u.roles.map((r) => r.name).join(', ') : '—'}</span>
                  <RequiresTooltip reason={canLink ? undefined : 'Requires work_center:link'}>
                    <Button type="button" variant="outline" size="sm" className="ml-2" aria-label={`Edit roles for ${u.displayName}`}
                      onClick={() => onEditRoles(u)} disabled={!canLink}
                      title={canLink ? undefined : 'Requires work_center:link'}>Roles…</Button>
                  </RequiresTooltip>
                </TableCell>
                <TableCell>{u.accessLevel}</TableCell>
                <TableCell>
                  <RequiresTooltip reason={canLink ? undefined : 'Requires work_center:link'}>
                    <input type="checkbox" className="h-4 w-4 accent-primary" aria-label={`Mission System Commander for ${u.displayName}`}
                      checked={u.missionSystemCommander} disabled={!canLink}
                      title={canLink ? undefined : 'Requires work_center:link'}
                      onChange={() => onToggleSystemCommander(u.id, !u.missionSystemCommander)} />
                  </RequiresTooltip>
                </TableCell>
                <TableCell>
                  <RequiresTooltip reason={canLink ? undefined : 'Requires work_center:link'}>
                    <Button type="button" variant="ghost" size="sm" aria-label={`Unassign ${u.displayName}`}
                      onClick={() => onUnassign(u)} disabled={!canLink}
                      title={canLink ? undefined : 'Requires work_center:link'}>✕</Button>
                  </RequiresTooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

// Read-only for name/version/state, same reason as WorkflowsTab — but the Action Server
// column is a real write surface: an administrator picks which Action Server this work
// center's runtime workflows dial for each environment. Bindings are NOT part of
// WorkCenterView (the parent's single fetch) — this tab fetches and owns them itself, so a
// steward who never opens Env Specs never pays for that extra round trip.
export function EnvironmentsTab({ environments, workCenterId }: { environments: EnvironmentSpec[]; workCenterId: string }) {
  // Same source RuntimeTab/WorkflowsTab use for their own gating (useMissionSystemCommander),
  // just reading the flat administrator flag instead of a per-work-center computation.
  const isAdmin = usePrincipalStore((s) => s.principal?.isAdministrator ?? false);
  const [bindings, setBindings] = useState<EnvironmentBinding[]>([]);
  const [savingOid, setSavingOid] = useState<string | null>(null);
  // Controlled per-row value, keyed by environmentOid. `bindings` (and therefore this) loads
  // asynchronously — a naive uncontrolled Input keyed on the fetched value would remount (and
  // silently destroy) whatever an admin had already typed the moment the fetch landed, and a
  // ref-based Save would then read the fresh, unedited node instead of the intended edit. To
  // avoid both, `dirtyRef` marks rows the admin has started editing; refresh() (initial load
  // AND the post-save refetch) only seeds `values` for rows NOT in `dirtyRef`, so an
  // in-progress edit is never clobbered and Save always reads what's actually on screen.
  const [values, setValues] = useState<Record<string, string>>({});
  const dirtyRef = useRef<Set<string>>(new Set());
  // Action-server trust policy, fetched once on mount (read permission is universal). A
  // failed fetch is swallowed — `policy` just stays null and the hint never shows.
  const [policy, setPolicy] = useState<{ trust: ActionServerTrust; allowlist: string[] } | null>(null);
  useEffect(() => {
    let cancelled = false;
    systemSettings.get()
      .then((s) => { if (!cancelled) setPolicy({ trust: s.actionServerTrust, allowlist: s.actionServerAllowlist }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const notAllowed = (value: string) => {
    if (!policy || policy.trust !== 'strict' || !value) return false;
    try {
      return !policy.allowlist.includes(new URL(value).origin);
    } catch {
      return false;
    }
  };

  // Only the newest refresh may land (a post-save refetch can finish after a later one), and a
  // failure is shown rather than left as an unhandled rejection.
  const reqToken = useRef(0);
  const refresh = useCallback(() => {
    const token = ++reqToken.current;
    environmentBindings.list(workCenterId).then((list) => {
      if (token !== reqToken.current) return;
      setBindings(list);
      setValues((prev) => {
        const next = { ...prev };
        for (const b of list) {
          if (!dirtyRef.current.has(b.environmentOid)) next[b.environmentOid] = b.serverUri;
        }
        return next;
      });
    }).catch((err) => {
      if (token === reqToken.current) toast.error(apiErrorMessage(err, 'Could not load Action Servers'));
    });
  }, [workCenterId]);

  useEffect(() => { refresh(); return () => { reqToken.current++; }; }, [refresh]);

  const uriFor = (oid: string) => bindings.find((b) => b.environmentOid === oid)?.serverUri ?? '';

  const handleChange = (oid: string, value: string) => {
    dirtyRef.current.add(oid);
    setValues((prev) => ({ ...prev, [oid]: value }));
  };

  const handleSave = async (oid: string) => {
    const value = values[oid] ?? '';
    setSavingOid(oid);
    try {
      await environmentBindings.set(workCenterId, oid, value);
      dirtyRef.current.delete(oid); // the just-saved value is the source of truth again
      toast.success('Action Server saved');
      refresh();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Save failed'));
    } finally {
      setSavingOid(null);
    }
  };

  if (environments.length === 0) return <p className="text-sm text-muted-foreground">No environment specs loaded</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Version</TableHead>
          <TableHead>State</TableHead>
          <TableHead>Action Server</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {environments.map((e) => (
          <TableRow key={e.id}>
            <TableCell>{e.name}</TableCell>
            <TableCell>{e.version}</TableCell>
            <TableCell><StateBadge state={e.state} effectiveFrom={e.effectiveFrom} /></TableCell>
            <TableCell>
              {isAdmin ? (
                <>
                  <div className="flex items-center gap-2">
                    <Input
                      value={values[e.oid] ?? ''}
                      onChange={(ev) => handleChange(e.oid, ev.target.value)}
                      className="h-8 w-56"
                      aria-label={`Action Server for ${e.name}`}
                    />
                    <Button type="button" size="sm" disabled={savingOid === e.oid}
                      onClick={() => handleSave(e.oid)}>
                      Save
                    </Button>
                  </div>
                  {notAllowed(values[e.oid] ?? '') && (
                    <p data-testid="action-server-not-allowed" className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                      Not in the allowed action servers list (Settings → Action server trust)
                    </p>
                  )}
                </>
              ) : (
                uriFor(e.oid) || '—'
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// Read-only: work-center roles have no link/unlink action in this view. The list is the
// work_center_role VIEW — roles referenced by this work center's loaded workflows (node-level
// allowed roles and e-signature roles), NOT membership; the help line says so.
function RolesTab({ roles }: { roles: Role[] }) {
  return (
    <div className="space-y-2">
      {roles.length === 0 ? <p className="text-sm text-muted-foreground">No roles</p> : (
        <RolesTable roles={roles} />
      )}
      <p className="text-xs text-muted-foreground">This is the list of roles used in workflows for this work center.</p>
    </div>
  );
}

function RolesTable({ roles }: { roles: Role[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Description</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {roles.map((r) => (
          <TableRow key={r.id}>
            <TableCell>{r.name}</TableCell>
            <TableCell>{r.description}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
