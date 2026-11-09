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
import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { schedules } from '@/lib/api/schedules';
import { usePolledView } from '@/lib/hooks/usePolledView';
import { NeedsAttentionPill } from './NeedsAttentionPill';
import { OccurrenceList } from './OccurrenceList';
import { ScheduleControls } from './ScheduleControls';
import { ScheduleEventLog } from './ScheduleEventLog';
import { ScheduleItemTree } from './ScheduleItemTree';
import type { OccurrenceRun, RuntimeScheduleDetail as RuntimeScheduleDetailView } from '@/lib/api/types';
import { STATUS_LABEL, defaultOnError, formatInZone, needsAttentionText, needsAttention, type OnError } from './schedule-format';

/** One Runtime Schedule: header, controls, the frozen tree, and its occurrences. Polls every 2 s. */
export function RuntimeScheduleDetail({ runtimeId, canControl, onError = defaultOnError, onBack, renderRunLink, onLoaded }: {
  runtimeId: string;
  canControl: boolean;
  onError?: OnError;
  onBack: () => void;
  renderRunLink?: (run: OccurrenceRun) => ReactNode;
  /** Called with each fresh read, so a caller can keep a Needs attention count current. */
  onLoaded?: (schedule: RuntimeScheduleDetailView) => void;
}) {
  const { view, loading, refresh } = usePolledView(
    `runtime-schedule:${runtimeId}`, () => schedules.getRuntime(runtimeId), 'Loading Runtime Schedule failed', 2000,
  );
  const [busyItem, setBusyItem] = useState<string | null>(null);
  useEffect(() => { if (view) onLoaded?.(view); }, [view]); // eslint-disable-line react-hooks/exhaustive-deps -- once per fresh read

  const toggle = async (itemId: string, disabled: boolean) => {
    setBusyItem(itemId);
    try { await schedules.setItemDisabled(runtimeId, itemId, disabled); refresh(); }
    catch (err) { onError(err, disabled ? 'Disable failed' : 'Re-enable failed'); }
    finally { setBusyItem(null); }
  };

  const back = <Button type="button" variant="outline" size="sm" onClick={onBack}>Back to Runtime Schedules</Button>;
  if (!view) return <div className="space-y-2">{back}<p className="text-sm text-muted-foreground">{loading ? 'Loading…' : 'Runtime Schedule unavailable'}</p></div>;

  return (
    <div className="space-y-4">
      {back}
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">{view.label} &quot;{view.name}&quot;</h2>
          <span className="text-sm text-muted-foreground">{STATUS_LABEL[view.status]}</span>
          <NeedsAttentionPill schedule={view} />
        </div>
        <p className="text-sm text-muted-foreground">{view.recurrenceText} · {view.timeZone}</p>
        {view.nextFireAt && (view.status === 'active' || view.status === 'paused') && (
          <p className="text-sm">Next start: {formatInZone(view.nextFireAt, view.timeZone)}</p>
        )}
        {needsAttention(view) && <p className="text-sm text-status-warn-fg">{needsAttentionText(view)}</p>}
        {view.masterChanged && <p className="text-sm text-muted-foreground">Master changed since Enable</p>}
      </div>
      <ScheduleControls schedule={view} canControl={canControl} onChanged={refresh} onError={onError} />
      <section className="space-y-2">
        <h3 className="text-sm font-medium">Workflows</h3>
        <ScheduleItemTree items={view.items} canControl={canControl && (view.status === 'active' || view.status === 'paused')}
          busyId={busyItem} onToggle={(it, disabled) => toggle(it.id, disabled)} />
      </section>
      <section className="space-y-2">
        <h3 className="text-sm font-medium">Occurrences</h3>
        <OccurrenceList runtimeId={runtimeId} items={view.items} timeZone={view.timeZone}
          canControl={canControl} onError={onError} onChanged={refresh} renderRunLink={renderRunLink} />
      </section>
      <section className="space-y-2">
        <h3 className="text-sm font-medium">Event log</h3>
        <ScheduleEventLog runtimeId={runtimeId} timeZone={view.timeZone} />
      </section>
    </div>
  );
}
