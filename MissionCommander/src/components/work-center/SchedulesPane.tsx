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
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { useMissionSystemCommander, usePrincipalStore } from '@/stores/principalStore';
import { apiErrorMessage } from '@/lib/api/client';
import type { CreatedRuntimeTarget, MasterScheduleView } from '@/lib/api/types';
import { RuntimeDialogStack } from '@/components/runtime/RuntimeDialogStack';
import { SchedulesTab } from '@/components/schedules/SchedulesTab';
import { MasterScheduleEditor } from '@/components/schedules/MasterScheduleEditor';
import { EnableDialog } from '@/components/schedules/EnableDialog';
import { RunOnceDialog, runOnceMessage } from '@/components/schedules/RunOnceDialog';
import { downloadMasterSchedulePdf } from '@/components/schedules/download-master-schedule-pdf';

/** Commander's wiring for the shared Schedules tab: who may control, how failures surface, the Master
 *  Schedule editor and Enable dialog (XO has neither), and where a run's label leads. A run still live
 *  opens the Runtime tab's dialog; a finished one opens the History tab's, through the same dialog
 *  stack both tabs use. */
export function SchedulesPane({ workCenterId }: { workCenterId: string }) {
  const canControl = useMissionSystemCommander(workCenterId);
  const [target, setTarget] = useState<CreatedRuntimeTarget | null>(null);
  // 'new' or the Master Schedule being edited; while set, the editor takes the pane's place.
  const [editing, setEditing] = useState<MasterScheduleView | 'new' | null>(null);
  const [enabling, setEnabling] = useState<MasterScheduleView | null>(null);
  const [runningOnce, setRunningOnce] = useState<MasterScheduleView | null>(null);
  const onError = (err: unknown, fallback: string) => toast.error(apiErrorMessage(err, fallback));
  const loginName = usePrincipalStore((s) => s.principal?.loginName ?? 'unknown');
  const exporting = useRef(false);
  const exportPdf = async (m: MasterScheduleView) => {
    if (exporting.current) return;
    exporting.current = true;
    try { toast.success(`Saved ${await downloadMasterSchedulePdf(m.id, loginName)}`); }
    catch (err) { onError(err, 'Could not create the PDF'); }
    finally { exporting.current = false; }
  };
  if (editing) {
    return (
      <MasterScheduleEditor workCenterId={workCenterId} master={editing === 'new' ? null : editing} onError={onError}
        onClose={() => setEditing(null)}
        onSaved={(saved) => { setEditing(null); toast.success(`Saved "${saved.name}"`); }} />
    );
  }
  return (
    <>
      <SchedulesTab workCenterId={workCenterId} canControl={canControl} onError={onError}
        onNew={() => setEditing('new')} onEdit={setEditing} onEnable={setEnabling} onRunOnce={setRunningOnce} onExportPdf={(m) => { void exportPdf(m); }}
        renderRunLink={(run) => run.open
          ? (
            <button type="button" className="underline-offset-2 hover:underline"
              aria-label={`Open ${run.runtimeLabel}`} onClick={() => setTarget(run.open)}>{run.runtimeLabel}</button>
          )
          : run.runtimeLabel} />
      {runningOnce && (
        <RunOnceDialog master={runningOnce} canSetZone onError={onError} onClose={() => setRunningOnce(null)}
          onStarted={({ runtime, warnings }, at) => {
            setRunningOnce(null);
            toast.success(runOnceMessage(runtime, at));
            if (warnings.length > 0) toast.warning(warnings.join(' '));
          }} />
      )}
      {target && <RuntimeDialogStack initial={target} onClose={() => setTarget(null)} />}
      {enabling && (
        <EnableDialog master={enabling} onError={onError} onClose={() => setEnabling(null)}
          onEnabled={({ runtime, warnings }) => {
            setEnabling(null);
            toast.success(`Recurrence enabled as ${runtime.label}`);
            if (warnings.length > 0) toast.warning(warnings.join(' '));
          }} />
      )}
    </>
  );
}
