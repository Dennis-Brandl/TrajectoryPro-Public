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
import { useMissionSystemCommander } from '@/stores/principalStore';
import { useSelectionStore } from '@/stores/selectionStore';
import { apiErrorMessage } from '@/lib/api/client';
import type { CreatedRuntimeTarget } from '@/lib/api/types';
import { RuntimeDialogStack } from '@/components/runtime/RuntimeDialogStack';
import { RuntimeScheduleDetail } from './RuntimeScheduleDetail';

/** The Schedules pane's detail: the selected Runtime Schedule, with the same controls and run links
 *  as the work center's Schedules tab (spec 2026-11-25). Back clears the selection. */
export function ScheduleRailDetail() {
  const sel = useSelectionStore((s) => s.selectedRuntimeSchedule);
  const select = useSelectionStore((s) => s.selectRuntimeSchedule);
  const canControl = useMissionSystemCommander(sel?.workCenterId ?? '');
  const [target, setTarget] = useState<CreatedRuntimeTarget | null>(null);
  if (!sel) return null;
  return (
    <div className="p-4">
      <RuntimeScheduleDetail key={sel.id} runtimeId={sel.id} canControl={canControl}
        onError={(err, fallback) => toast.error(apiErrorMessage(err, fallback))}
        onBack={() => select(null)}
        renderRunLink={(run) => run.open
          ? (
            <button type="button" className="underline-offset-2 hover:underline"
              aria-label={`Open ${run.runtimeLabel}`} onClick={() => setTarget(run.open)}>{run.runtimeLabel}</button>
          )
          : run.runtimeLabel} />
      {target && <RuntimeDialogStack initial={target} onClose={() => setTarget(null)} />}
    </div>
  );
}
