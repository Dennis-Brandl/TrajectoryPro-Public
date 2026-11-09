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
import { Link, useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { EnableDialog } from '@/components/schedules/EnableDialog';
import { MasterScheduleList } from '@/components/schedules/MasterScheduleList';
import { RuntimeScheduleDetail } from '@/components/schedules/RuntimeScheduleDetail';
import { RunOnceDialog, runOnceMessage } from '@/components/schedules/RunOnceDialog';
import { RuntimeScheduleList } from '@/components/schedules/RuntimeScheduleList';
import type { MasterScheduleView, OccurrenceRun } from '@/lib/api/types';
import { reportControlError } from '~/components/running/controls';
import { useWorkCenter } from '~/components/shell/WorkCenterShell';
import { useScheduleAttentionStore } from '~/stores/scheduleAttentionStore';

/** The Schedules view: Runtime Schedules first, then a compact Masters list with Run Once and Enable Recurrence. XO has no
 *  Master Schedule editor, so Edit, Delete and New are absent. Layout is one column of cards. */
export function SchedulesView({ wcId }: { wcId: string }) {
  const wc = useWorkCenter();
  const navigate = useNavigate();
  const setAll = useScheduleAttentionStore((s) => s.setAll);
  const [enabling, setEnabling] = useState<MasterScheduleView | null>(null);
  const [runningOnce, setRunningOnce] = useState<MasterScheduleView | null>(null);
  const canControl = wc.mode === 'full';
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4">
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Runtime Schedules</h2>
        <RuntimeScheduleList workCenterId={wcId} canControl={canControl} onError={reportControlError} variant="cards"
          onLoaded={(rows) => setAll(wcId, rows)}
          onOpen={(runtimeId) => { void navigate({ to: '/wc/$wcId/schedules/$runtimeId', params: { wcId, runtimeId } }); }} />
      </section>
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Master Schedules</h2>
        <MasterScheduleList workCenterId={wcId} canControl={canControl} onError={reportControlError} variant="cards"
          canDelete={false} onEnable={setEnabling} onRunOnce={setRunningOnce} />
      </section>
      {runningOnce && (
        <RunOnceDialog master={runningOnce} onError={reportControlError} onClose={() => setRunningOnce(null)}
          onStarted={({ runtime, warnings }, at) => {
            setRunningOnce(null);
            toast.success(runOnceMessage(runtime, at));
            if (warnings.length > 0) toast.warning(warnings.join(' '));
          }} />
      )}
      {enabling && (
        <EnableDialog master={enabling} onError={reportControlError} onClose={() => setEnabling(null)}
          onEnabled={({ runtime, warnings }) => {
            setEnabling(null);
            toast.success(`Recurrence enabled as ${runtime.label}`);
            if (warnings.length > 0) toast.warning(warnings.join(' '));
          }} />
      )}
    </div>
  );
}

/** One Runtime Schedule. A run's label opens its live Runtime while it exists, else its History record. */
export function ScheduleDetailView({ wcId, runtimeId }: { wcId: string; runtimeId: string }) {
  const wc = useWorkCenter();
  const navigate = useNavigate();
  const setOne = useScheduleAttentionStore((s) => s.setOne);
  const runLink = (run: OccurrenceRun) => {
    if (!run.open) return run.runtimeLabel;
    const cls = 'inline-block min-h-8 py-1 underline-offset-2 hover:underline';
    return run.open.kind === 'live'
      ? <Link to="/wc/$wcId/running/$runtimeId" params={{ wcId, runtimeId: run.open.id }} className={cls}>{run.runtimeLabel}</Link>
      : <Link to="/wc/$wcId/history/$historyId" params={{ wcId, historyId: run.open.id }} className={cls}>{run.runtimeLabel}</Link>;
  };
  return (
    <div className="mx-auto w-full max-w-3xl p-4">
      <RuntimeScheduleDetail runtimeId={runtimeId} canControl={wc.mode === 'full'} onError={reportControlError}
        onLoaded={(d) => setOne(wcId, d)} renderRunLink={runLink}
        onBack={() => { void navigate({ to: '/wc/$wcId/schedules', params: { wcId } }); }} />
    </div>
  );
}
