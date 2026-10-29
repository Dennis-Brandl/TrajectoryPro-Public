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
import { workCenters } from '@/lib/api/work-centers';
import { usePolledView } from '@/lib/hooks/usePolledView';
import { useMissionSystemCommander } from '@/stores/principalStore';
import { ResourceTable, toSharedResourceRow, type ResourceTableRow } from '@/components/shared/ResourceTable';
import { resourceVerbCall, verbFailText, verbSuccessText, type ResourceVerbArgs } from '@/components/shared/ResourceActions';
import { ValuePropertyTable } from '@/components/shared/ValuePropertyTable';
import { useActionRunner } from '@/components/shared/useActionRunner';
import { SHARED_STATE_POLL_MS } from '@/components/shared/shared-state-poll';
import type { ResourceVerb, SharedValuePropertyView } from '@/lib/api/types';

// Phase 3 (spec §6.4): the backstop view — every registry row of the work center, orphans
// included. A resource whose declaring env spec was deleted is invisible from every environment
// pane; this is the only place it can be seen — and, since Phase 4b (spec §7.2-7.3), the only
// place it can be released, reset or edited. One tab holding two sections rather than two tabs:
// WorkCenterDetail is already at six. Mounted (and polling) only while the tab is active.
export function SharedStateTab({ workCenterId }: { workCenterId: string }) {
  const fetcher = useCallback(async () => {
    const [r, v] = await Promise.all([workCenters.resources(workCenterId), workCenters.valueProperties(workCenterId)]);
    return { resources: r.resources, values: v.values };
  }, [workCenterId]);
  const { view, loading, error, stale, refresh } = usePolledView(`shared-state:${workCenterId}`, fetcher, 'Failed to load shared state', SHARED_STATE_POLL_MS);
  const canCommand = useMissionSystemCommander(workCenterId);
  const { busy, run } = useActionRunner(refresh);
  if (loading && !view) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error && !view) return <p className="text-sm text-destructive">Failed to load shared state</p>;
  if (!view) return null;
  const onVerb = (row: ResourceTableRow, verb: ResourceVerb, args: ResourceVerbArgs) =>
    void run(resourceVerbCall(row, verb, args), verbSuccessText(verb, row.name), verbFailText(verb));
  const onSave = (v: SharedValuePropertyView, value: string) =>
    void run(() => workCenters.setValue(workCenterId, { propertyName: v.propertyName, entryName: v.entryName, value }),
      `Updated ${v.propertyName}.${v.entryName}`, 'Value update failed');
  return (
    <div className="space-y-4">
      {stale && <p className="text-xs text-muted-foreground" role="status">Live view unavailable — showing last known state</p>}
      <section className="space-y-1">
        <h3 className="text-sm font-medium">Resources</h3>
        <ResourceTable rows={view.resources.map(toSharedResourceRow)} emptyText="No shared resources in this work center"
          actions={{ canCommand, busy, onVerb }} />
      </section>
      <section className="space-y-1">
        <h3 className="text-sm font-medium">Value properties</h3>
        <ValuePropertyTable values={view.values} emptyText="No shared value properties in this work center"
          edit={{ canCommand, busy, onSave }} />
      </section>
    </div>
  );
}
