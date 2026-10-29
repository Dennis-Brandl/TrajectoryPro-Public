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
import { useCallback } from 'react';
import { runtimeWorkflows } from '@/lib/api/runtime-workflows';
import { workCenters } from '@/lib/api/work-centers';
import { usePolledView } from '@/lib/hooks/usePolledView';
import { useMissionSystemCommander } from '@/stores/principalStore';
import { ResourceTable, toSharedResourceRow, toWorkflowResourceRow, type ResourceTableRow } from '@/components/shared/ResourceTable';
import { resourceVerbCall, verbFailText, verbSuccessText, type ResourceVerbArgs } from '@/components/shared/ResourceActions';
import { FlatPropertyTable, ValuePropertyTable } from '@/components/shared/ValuePropertyTable';
import { useActionRunner } from '@/components/shared/useActionRunner';
import { SHARED_STATE_POLL_MS } from '@/components/shared/shared-state-poll';
import type { ResourceVerb, SharedValuePropertyView } from '@/lib/api/types';

// Phase 3 (spec §6.5): two sections in the Runtime pane's scrolling stack. Each owns its own
// poll (plan delta D10, the RuntimeDiagramCard precedent) so a failure here never blanks the
// pane's existing detail. SHARED_STATE_POLL_MS equals RUNTIME_PANE_POLL_MS; importing the latter
// from RuntimeWorkflowDetail would be a circular import.
//
// Phase 4b (spec §7.3, §12.5 item 23, plan delta D21): verbs on a WORKFLOW row go to the
// instance routes; verbs on an ENVIRONMENT row go to the work-center routes — reached through
// an instance they would still act on the whole work-center resource, so the pane must not
// present them as instance-scoped (resourceVerbCall routes on the row's target; ConfirmStrip
// says so). Value edits likewise: root/child stores → instance route; the shared group → the
// work-center route, under a note that says the edit is work-center-wide.

const SHARED_NOTE = 'Shared with the work center — an edit here changes the value every running workflow reads.';

function StaleNotice() {
  return <p className="text-xs text-muted-foreground" role="status">Live view unavailable — showing last known state</p>;
}

export function RuntimeResourcesSection({ instanceId, workCenterId }: { instanceId: string; workCenterId: string }) {
  const fetcher = useCallback(() => runtimeWorkflows.resources(instanceId), [instanceId]);
  const { view, loading, error, stale, refresh } = usePolledView(`runtime-resources:${instanceId}`, fetcher, 'Failed to load resources', SHARED_STATE_POLL_MS);
  const canCommand = useMissionSystemCommander(workCenterId);
  const { busy, run } = useActionRunner(refresh);
  const onVerb = (row: ResourceTableRow, verb: ResourceVerb, args: ResourceVerbArgs) =>
    void run(resourceVerbCall(row, verb, args), verbSuccessText(verb, row.name), verbFailText(verb));
  return (
    <div className="space-y-1">
      <h3 className="text-sm font-medium">Resources</h3>
      {loading && !view && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && !view && <p className="text-sm text-destructive">Failed to load resources</p>}
      {view && (
        <>
          {stale && <StaleNotice />}
          <ResourceTable showScope
            rows={[
              ...view.workflow.map((r) => toWorkflowResourceRow(r, { id: view.instanceId, runtimeNumber: view.runtimeNumber, runtimeLabel: view.runtimeLabel })),
              ...view.environment.map(toSharedResourceRow),
            ]}
            emptyText="This runtime workflow uses no resources"
            actions={{ canCommand, busy, onVerb }} />
        </>
      )}
    </div>
  );
}

const GROUP = 'text-xs font-semibold uppercase text-muted-foreground';

export function RuntimeValuePropertiesSection({ instanceId, workCenterId }: { instanceId: string; workCenterId: string }) {
  const fetcher = useCallback(() => runtimeWorkflows.valueProperties(instanceId), [instanceId]);
  const { view, loading, error, stale, refresh } = usePolledView(`runtime-values:${instanceId}`, fetcher, 'Failed to load value properties', SHARED_STATE_POLL_MS);
  const canCommand = useMissionSystemCommander(workCenterId);
  const { busy, run } = useActionRunner(refresh);
  const saveLocal = (specOid: string | undefined) => (key: string, value: string) =>
    void run(() => runtimeWorkflows.setValue(instanceId, { ...(specOid ? { specOid } : {}), key, value }), `Updated ${key}`, 'Value update failed');
  const saveShared = (v: SharedValuePropertyView, value: string) =>
    void run(() => workCenters.setValue(v.workCenterId, { propertyName: v.propertyName, entryName: v.entryName, value }),
      `Updated ${v.propertyName}.${v.entryName}`, 'Value update failed');
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">Value properties</h3>
      {loading && !view && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && !view && <p className="text-sm text-destructive">Failed to load value properties</p>}
      {view && (
        <>
          {stale && <StaleNotice />}
          <section className="space-y-1">
            <h4 className={GROUP}>Workflow</h4>
            <FlatPropertyTable values={view.root} emptyText="No workflow value properties" edit={{ canCommand, busy, onSave: saveLocal(undefined) }} />
          </section>
          {view.children.map((c) => (
            <section key={c.childOid} className="space-y-1">
              <h4 className={GROUP}>Child · {c.childName ?? c.childOid}</h4>
              <FlatPropertyTable values={c.values} emptyText="No value properties" edit={{ canCommand, busy, onSave: saveLocal(c.childOid) }} />
            </section>
          ))}
          <section className="space-y-1">
            <h4 className={GROUP}>Shared (environment)</h4>
            <ValuePropertyTable values={view.shared} emptyText="No shared value properties in this work center"
              edit={{ canCommand, busy, note: SHARED_NOTE, onSave: saveShared }} />
          </section>
        </>
      )}
    </div>
  );
}
