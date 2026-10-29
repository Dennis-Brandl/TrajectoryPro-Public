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
import { toast } from 'sonner';
import { useSelectionStore } from '@/stores/selectionStore';
import { useHasRight, useMissionSystemCommander } from '@/stores/principalStore';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { workflows, patchWorkflowDispatchPolicy, patchWorkflowAutoClaim } from '@/lib/api/workflows';
import { apiErrorMessage } from '@/lib/api/client';
import type { EnvironmentSpec } from '@/lib/api/types';
import { RefreshErrorBanner } from '@/components/shell/RefreshErrorBanner';
import { StateBadge } from '@/components/artifact/StateBadge';
import { DeleteSpecDialog } from '@/components/shared/DeleteSpecDialog';
import { RequiresTooltip } from '@/components/shared/RequiresTooltip';
import { CreateRuntimeWorkflowDialog } from '@/components/runtime/CreateRuntimeWorkflowDialog';
import { refreshWorkflowTree } from './WorkflowTree';
import { useWorkflowView } from './useWorkflowView';
import { DiagramTab } from './DiagramTab';
import { DispatchPolicySelect } from './DispatchPolicySelect';
import { AutoClaimSelect } from './AutoClaimSelect';

export function WorkflowDetail() {
  const selectedWorkflowId = useSelectionStore((s) => s.selectedWorkflowId);
  const setHierarchy = useSelectionStore((s) => s.setHierarchy);
  const selectEnvironment = useSelectionStore((s) => s.selectEnvironment);
  const selectWorkCenter = useSelectionStore((s) => s.selectWorkCenter);
  const { view, loading, error, refresh } = useWorkflowView(selectedWorkflowId);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [runtimeOpen, setRuntimeOpen] = useState(false);
  const canDelete = useHasRight('workflow:delete');
  // Gates the dispatch-policy Select the same way canDelete gates Delete: display-only, the
  // server re-authorizes the PATCH itself (requirePermission('workflow:edit')).
  const canEditDispatch = useHasRight('workflow:edit');
  // Gated on Mission System Commander of the workflow's own work center, not a static access-tier
  // right — a Viewer who commands this work center can still start work here. `undefined`
  // while the view hasn't loaded yet; useMissionSystemCommander treats that as "not commander",
  // and this hook must run above the early returns below to keep hook order stable.
  const canCommand = useMissionSystemCommander(view?.workflow.workCenterId);

  if (loading && !view) return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;
  if (error && !view) return <div className="p-4 text-sm text-destructive">Failed to load workflow</div>;
  if (!view) return null;

  // Same refresh()-after-write pattern WorkCenterDetail's EnvironmentsTab.handleSave uses:
  // this app has no query-cache to invalidate, so a mutation just re-fetches the detail view.
  const handleDispatchPolicyChange = async (policy: string | null) => {
    try {
      await patchWorkflowDispatchPolicy(view.workflow.id, policy);
      toast.success('Dispatch policy saved');
      refresh();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Failed to save dispatch policy'));
    }
  };

  const handleAutoClaimChange = async (value: boolean | null) => {
    try {
      await patchWorkflowAutoClaim(view.workflow.id, value);
      toast.success('Auto-claim saved');
      refresh();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Failed to save auto-claim'));
    }
  };

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      {error && <RefreshErrorBanner />}
      <div className="space-y-1">
        <div className="text-sm text-muted-foreground">Workflows ›</div>
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-xl font-semibold">{view.workflow.name}</h1>
          <div className="flex gap-2">
            <RequiresTooltip reason={canCommand ? undefined : 'Requires Mission System Commander'}>
              <Button type="button" variant="outline" size="sm" onClick={() => setRuntimeOpen(true)}
                disabled={!canCommand} title={canCommand ? undefined : 'Requires Mission System Commander'}>Create Runtime Workflow…</Button>
            </RequiresTooltip>
            <RequiresTooltip reason={canDelete ? undefined : 'Requires workflow:delete'}>
              <Button type="button" variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}
                disabled={!canDelete} title={canDelete ? undefined : 'Requires workflow:delete'}>Delete</Button>
            </RequiresTooltip>
          </div>
        </div>
        {view.workflow.typeName && (
          <div className="text-sm text-muted-foreground">
            Type: <span className="font-medium text-foreground">{view.workflow.typeName}</span>
          </div>
        )}
      </div>
      <DeleteSpecDialog open={deleteOpen} onOpenChange={setDeleteOpen} kind="workflow" name={view.workflow.name}
        onConfirm={() => workflows.remove(view.workflow.id)}
        onDeleted={() => { refreshWorkflowTree(); useSelectionStore.getState().selectWorkflow(null); }} />
      <CreateRuntimeWorkflowDialog
        open={runtimeOpen} onOpenChange={setRuntimeOpen}
        workflowId={view.workflow.id} workflowName={view.workflow.name}
        workflowVersion={view.workflow.version} workflowState={view.workflow.state}
      />
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="environments">Environments</TabsTrigger>
          <TabsTrigger value="diagram">Diagram</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
            <dt className="text-muted-foreground">Version</dt><dd>{view.workflow.version}</dd>
            <dt className="text-muted-foreground">State</dt><dd><StateBadge state={view.workflow.state} effectiveFrom={view.workflow.effectiveFrom} /></dd>
            <dt className="text-muted-foreground">Work center</dt>
            <dd>
              {/* An artifact belongs to exactly ONE work center (spec §5), so this is a
                  single owner, not a list — the plural "Work Centers" tab that used to
                  live here is gone with the link verbs it depended on. */}
              <button type="button" className="text-left underline-offset-2 hover:underline"
                onClick={() => { setHierarchy('work_center'); selectWorkCenter(view.workCenter.id); }}>
                {view.workCenter.name}
              </button>
            </dd>
            <dt className="text-muted-foreground">OID</dt><dd className="font-mono text-xs">{view.workflow.oid}</dd>
          </dl>
          <div className="mt-4 max-w-xs space-y-4">
            {/* 2026-08-17 user feedback: promote these from fine print to a visible section. */}
            <h2 className="text-base font-semibold">Operator dispatch</h2>
            <RequiresTooltip reason={canEditDispatch ? undefined : 'Requires workflow:edit'}>
              <DispatchPolicySelect
                value={view.workflow.dispatchPolicy}
                onChange={handleDispatchPolicyChange}
                disabled={!canEditDispatch}
              />
            </RequiresTooltip>
            <RequiresTooltip reason={canEditDispatch ? undefined : 'Requires workflow:edit'}>
              <AutoClaimSelect
                value={view.workflow.autoClaim}
                onChange={handleAutoClaimChange}
                disabled={!canEditDispatch}
              />
            </RequiresTooltip>
          </div>
          {view.workflow.sourceLibraryName && (
            <div className="mt-4 rounded border bg-muted/40 p-3 text-sm">
              <div className="font-medium">Mission Designer provenance</div>
              {/* Display-only (spec D9): the originating Designer library is traceability, it
                  never routes or groups anything here — so it is deliberately not a link. */}
              <dl className="mt-1 grid grid-cols-[8rem_1fr] gap-y-1">
                <dt className="text-muted-foreground">Library</dt><dd>{view.workflow.sourceLibraryName}</dd>
                {view.workflow.sourceLibraryOid && (
                  <>
                    <dt className="text-muted-foreground">Library OID</dt>
                    <dd className="font-mono text-xs">{view.workflow.sourceLibraryOid}</dd>
                  </>
                )}
              </dl>
            </div>
          )}
        </TabsContent>
        <TabsContent value="environments">
          {view.environments.length === 0 ? <p className="text-sm text-muted-foreground">No embedded environment specs</p> : (
            <Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Version</TableHead><TableHead>State</TableHead></TableRow></TableHeader>
              <TableBody>{view.environments.map((e: EnvironmentSpec) => (
                <TableRow key={e.id}>
                  <TableCell><button type="button" className="text-left underline-offset-2 hover:underline"
                    onClick={() => { setHierarchy('environment'); selectEnvironment(e.id); }}>{e.name}</button></TableCell>
                  <TableCell>{e.version}</TableCell>
                  <TableCell><StateBadge state={e.state} effectiveFrom={e.effectiveFrom} /></TableCell>
                </TableRow>))}</TableBody></Table>
          )}
        </TabsContent>
        <TabsContent value="diagram">
          <DiagramTab workflowId={view.workflow.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
