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
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import type { OccurrenceRun } from '@/lib/api/types';
import { MasterScheduleList, type MasterAction } from './MasterScheduleList';
import { RuntimeScheduleDetail } from './RuntimeScheduleDetail';
import { RuntimeScheduleList } from './RuntimeScheduleList';
import type { OnError } from './schedule-format';

/** The work-center Schedules tab (spec 2026-11-08 §10). Reads nothing from Commander's stores:
 *  `canControl` and `onError` arrive as props so XO can reuse it. The editor and the Enable dialog
 *  belong to the caller (XO has no editor), which supplies `onNew`, `onEdit` and `onEnable`; until it
 *  does, Edit and Enable show as disabled buttons and there is no New button. */
export function SchedulesTab({ workCenterId, canControl, onError, onNew, onEdit = 'disabled', onEnable = 'disabled', onRunOnce, onExportPdf, renderRunLink }: {
  workCenterId: string;
  canControl: boolean;
  onError?: OnError;
  onNew?: () => void;
  onEdit?: MasterAction;
  onEnable?: MasterAction;
  onRunOnce?: MasterAction;
  onExportPdf?: MasterAction;
  renderRunLink?: (run: OccurrenceRun) => ReactNode;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (openId) {
    return <RuntimeScheduleDetail runtimeId={openId} canControl={canControl} onError={onError} onBack={() => setOpenId(null)} renderRunLink={renderRunLink} />;
  }
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h3 className="text-sm font-medium">Runtime Schedules</h3>
        <RuntimeScheduleList workCenterId={workCenterId} canControl={canControl} onError={onError} onOpen={setOpenId} />
      </section>
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">Master Schedules</h3>
          {canControl && onNew && <Button type="button" variant="outline" size="sm" onClick={onNew}>New Master Schedule</Button>}
        </div>
        <MasterScheduleList workCenterId={workCenterId} canControl={canControl} onError={onError} onEdit={onEdit} onEnable={onEnable} onRunOnce={onRunOnce} onExportPdf={onExportPdf} />
      </section>
    </div>
  );
}
