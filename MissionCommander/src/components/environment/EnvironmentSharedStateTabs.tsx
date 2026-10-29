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
import { environments } from '@/lib/api/environments';
import { workCenters } from '@/lib/api/work-centers';
import { usePolledView } from '@/lib/hooks/usePolledView';
import { useMissionSystemCommander } from '@/stores/principalStore';
import { ResourceTable, toSharedResourceRow, type ResourceTableRow } from '@/components/shared/ResourceTable';
import { resourceVerbCall, verbFailText, verbSuccessText, type ResourceVerbArgs } from '@/components/shared/ResourceActions';
import { ValuePropertyTable } from '@/components/shared/ValuePropertyTable';
import { useActionRunner } from '@/components/shared/useActionRunner';
import { SHARED_STATE_POLL_MS } from '@/components/shared/shared-state-poll';
import type { ResourceVerb, SharedValuePropertyView } from '@/lib/api/types';

// Phase 3 (spec §6.3): the Environment pane's two live tabs. Each is mounted only while its tab
// is active (Radix unmounts inactive TabsContent), which is the whole lazy-fetch and
// stop-polling mechanism — no gating of our own.
//
// Phase 4b (spec §7.2-7.3): the tabs gain the operator verbs and inline value edits. The
// environment pane has no writer of its own — every write goes to the WORK-CENTER routes with
// the workCenterId the view carries, because an environment row is a filtered view of
// work-center state. Commander gating is per work center (useMissionSystemCommander).

function StaleNotice() {
  return <p className="text-xs text-muted-foreground" role="status">Live view unavailable — showing last known state</p>;
}

// Plan delta D5: a spec loaded before the registry existed has no rows and no backfill (spec
// §12.2 item 14). Name the gap and its fix rather than claiming the spec declares nothing.
function UnregisteredNotice({ names }: { names: string[] }) {
  return (
    <p role="status" className="rounded border bg-muted/40 p-2 text-sm">
      Declared but not registered: {names.join(', ')}. Re-load this environment spec to register them.
    </p>
  );
}

export function EnvironmentResourcesTab({ envId }: { envId: string }) {
  const fetcher = useCallback(() => environments.resources(envId), [envId]);
  const { view, loading, error, stale, refresh } = usePolledView(`env-resources:${envId}`, fetcher, 'Failed to load resources', SHARED_STATE_POLL_MS);
  const canCommand = useMissionSystemCommander(view?.workCenterId ?? null);
  const { busy, run } = useActionRunner(refresh);
  if (loading && !view) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error && !view) return <p className="text-sm text-destructive">Failed to load resources</p>;
  if (!view) return null;
  const unregistered = view.unregistered.length > 0;
  const onVerb = (row: ResourceTableRow, verb: ResourceVerb, args: ResourceVerbArgs) =>
    void run(resourceVerbCall(row, verb, args), verbSuccessText(verb, row.name), verbFailText(verb));
  return (
    <div className="space-y-2">
      {stale && <StaleNotice />}
      {unregistered && <UnregisteredNotice names={view.unregistered} />}
      <ResourceTable rows={view.resources.map(toSharedResourceRow)}
        emptyText={unregistered ? 'No registered resources yet' : 'This environment declares no resources'}
        actions={{ canCommand, busy, onVerb }} />
    </div>
  );
}

export function EnvironmentValuePropertiesTab({ envId }: { envId: string }) {
  const fetcher = useCallback(() => environments.valueProperties(envId), [envId]);
  const { view, loading, error, stale, refresh } = usePolledView(`env-values:${envId}`, fetcher, 'Failed to load value properties', SHARED_STATE_POLL_MS);
  const canCommand = useMissionSystemCommander(view?.workCenterId ?? null);
  const { busy, run } = useActionRunner(refresh);
  if (loading && !view) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error && !view) return <p className="text-sm text-destructive">Failed to load value properties</p>;
  if (!view) return null;
  const unregistered = view.unregistered.length > 0;
  const onSave = (v: SharedValuePropertyView, value: string) =>
    void run(() => workCenters.setValue(v.workCenterId, { propertyName: v.propertyName, entryName: v.entryName, value }),
      `Updated ${v.propertyName}.${v.entryName}`, 'Value update failed');
  return (
    <div className="space-y-2">
      {stale && <StaleNotice />}
      {unregistered && <UnregisteredNotice names={view.unregistered.map((u) => `${u.propertyName}.${u.entryName}`)} />}
      <ValuePropertyTable values={view.values}
        emptyText={unregistered ? 'No registered value properties yet' : 'This environment declares no value properties'}
        edit={{ canCommand, busy, onSave }} />
    </div>
  );
}
