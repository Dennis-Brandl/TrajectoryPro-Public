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
import { useHasRight } from '@/stores/principalStore';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { environments } from '@/lib/api/environments';
import type { Workflow } from '@/lib/api/types';
import { RefreshErrorBanner } from '@/components/shell/RefreshErrorBanner';
import { StateBadge } from '@/components/artifact/StateBadge';
import { DeleteSpecDialog } from '@/components/shared/DeleteSpecDialog';
import { RequiresTooltip } from '@/components/shared/RequiresTooltip';
import { refreshEnvironmentTree } from './EnvironmentTree';
import { useEnvSpecView } from './useEnvSpecView';
import { EnvironmentResourcesTab, EnvironmentValuePropertiesTab } from './EnvironmentSharedStateTabs';

// Structural twin of WorkflowDetail.tsx, minus the Diagram tab: an environment spec has no
// step graph of its own. The cross-nav tab here points at WORKFLOWS (the workflows that use
// this environment spec), mirroring WorkflowDetail's Environments tab but in the opposite
// direction.
export function EnvironmentDetail() {
  const selectedEnvironmentId = useSelectionStore((s) => s.selectedEnvironmentId);
  const setHierarchy = useSelectionStore((s) => s.setHierarchy);
  const selectWorkflow = useSelectionStore((s) => s.selectWorkflow);
  const selectWorkCenter = useSelectionStore((s) => s.selectWorkCenter);
  const { view, loading, error } = useEnvSpecView(selectedEnvironmentId);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const canDelete = useHasRight('environment:delete');

  if (loading && !view) return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;
  if (error && !view) return <div className="p-4 text-sm text-destructive">Failed to load environment</div>;
  if (!view) return null;

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      {error && <RefreshErrorBanner />}
      <div className="space-y-1">
        <div className="text-sm text-muted-foreground">Environments ›</div>
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-xl font-semibold">{view.environmentSpec.name}</h1>
          <RequiresTooltip reason={canDelete ? undefined : 'Requires environment:delete'}>
            <Button type="button" variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}
              disabled={!canDelete} title={canDelete ? undefined : 'Requires environment:delete'}>Delete</Button>
          </RequiresTooltip>
        </div>
      </div>
      <DeleteSpecDialog open={deleteOpen} onOpenChange={setDeleteOpen} kind="environment" name={view.environmentSpec.name}
        onConfirm={() => environments.remove(view.environmentSpec.id)}
        onDeleted={() => { refreshEnvironmentTree(); useSelectionStore.getState().selectEnvironment(null); }} />
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="actions">Actions</TabsTrigger>
          <TabsTrigger value="workflows">Workflows</TabsTrigger>
          <TabsTrigger value="resources">Resources</TabsTrigger>
          <TabsTrigger value="value-properties">Value Properties</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
            <dt className="text-muted-foreground">Version</dt><dd>{view.environmentSpec.version}</dd>
            <dt className="text-muted-foreground">State</dt><dd><StateBadge state={view.environmentSpec.state} effectiveFrom={view.environmentSpec.effectiveFrom} /></dd>
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
            <dt className="text-muted-foreground">OID</dt><dd className="font-mono text-xs">{view.environmentSpec.oid}</dd>
          </dl>
          <div className="mt-4 rounded border p-3 text-sm">
            <div className="font-medium">Action server</div>
            <dl className="mt-1 grid grid-cols-[12rem_1fr] gap-y-1">
              <dt className="text-muted-foreground">Designer server</dt>
              <dd>
                {view.actionServers.length === 0 ? <span className="text-muted-foreground">None declared</span> : (
                  <ul className="space-y-0.5">
                    {view.actionServers.map((a, i) => (
                      <li key={i}>
                        <span>{a.name || '(unnamed)'}</span>{' '}
                        {a.uri ? <span className="font-mono text-xs">{a.uri}</span> : <span className="text-muted-foreground">(blank)</span>}
                      </li>))}
                  </ul>
                )}
              </dd>
              <dt className="text-muted-foreground">This work center&apos;s binding</dt>
              <dd>
                {view.binding ? (
                  <>
                    <span className="font-mono text-xs">{view.binding.serverUri}</span>
                    {!view.binding.allowlisted && (
                      <div className="text-amber-700 dark:text-amber-400">Not on the action-server allowlist — add it under Settings → Action server trust.</div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="text-amber-700 dark:text-amber-400">No action server bound in this work center — actions in this environment will fail until one is set.</div>
                    <button type="button" className="underline underline-offset-2"
                      onClick={() => { setHierarchy('work_center'); selectWorkCenter(view.workCenter.id); }}>Set binding</button>
                  </>
                )}
              </dd>
            </dl>
          </div>
          {view.environmentSpec.sourceLibraryName && (
            <div className="mt-4 rounded border bg-muted/40 p-3 text-sm">
              <div className="font-medium">Mission Designer provenance</div>
              {/* Display-only (spec D9): the originating Designer library is traceability, it
                  never routes or groups anything here — so it is deliberately not a link. */}
              <dl className="mt-1 grid grid-cols-[8rem_1fr] gap-y-1">
                <dt className="text-muted-foreground">Library</dt><dd>{view.environmentSpec.sourceLibraryName}</dd>
                {view.environmentSpec.sourceLibraryOid && (
                  <>
                    <dt className="text-muted-foreground">Library OID</dt>
                    <dd className="font-mono text-xs">{view.environmentSpec.sourceLibraryOid}</dd>
                  </>
                )}
              </dl>
            </div>
          )}
        </TabsContent>
        <TabsContent value="actions">
          {view.actions.length === 0 ? <p className="text-sm text-muted-foreground">This environment has no actions</p> : (
            <Table><TableHeader><TableRow><TableHead>Action</TableHead><TableHead>Library</TableHead><TableHead>Version</TableHead><TableHead>Inputs</TableHead><TableHead>Outputs</TableHead></TableRow></TableHeader>
              <TableBody>{view.actions.map((a, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <div>{a.name}</div>
                    {a.description && <div className="text-xs text-muted-foreground">{a.description}</div>}
                  </TableCell>
                  <TableCell>{a.library ?? '—'}</TableCell>
                  <TableCell>{a.version ?? '—'}</TableCell>
                  <TableCell>{a.inputs.length ? a.inputs.join(', ') : '—'}</TableCell>
                  <TableCell>{a.outputs.length ? a.outputs.join(', ') : '—'}</TableCell>
                </TableRow>))}</TableBody></Table>
          )}
        </TabsContent>
        <TabsContent value="workflows">
          {view.workflows.length === 0 ? <p className="text-sm text-muted-foreground">No workflows use this environment spec</p> : (
            <Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Version</TableHead><TableHead>State</TableHead></TableRow></TableHeader>
              <TableBody>{view.workflows.map((w: Workflow) => (
                <TableRow key={w.id}>
                  <TableCell><button type="button" className="text-left underline-offset-2 hover:underline"
                    onClick={() => { setHierarchy('workflow'); selectWorkflow(w.id); }}>{w.name}</button></TableCell>
                  <TableCell>{w.version}</TableCell>
                  <TableCell><StateBadge state={w.state} effectiveFrom={w.effectiveFrom} /></TableCell>
                </TableRow>))}</TableBody></Table>
          )}
        </TabsContent>
        {/* Phase 3 (spec §6.3): live shared state, polled only while the tab is open. */}
        <TabsContent value="resources">
          <EnvironmentResourcesTab envId={view.environmentSpec.id} />
        </TabsContent>
        <TabsContent value="value-properties">
          <EnvironmentValuePropertiesTab envId={view.environmentSpec.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
