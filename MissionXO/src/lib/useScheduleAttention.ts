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
import { useEffect } from 'react';
import { schedules } from '@/lib/api/schedules';
import { usePolledView } from '@/lib/hooks/usePolledView';
import { useScheduleAttentionStore, scheduleAttentionCount } from '~/stores/scheduleAttentionStore';
import type { XoView } from '~/components/shell/WorkCenterShell';

const REFRESH_MS = 60_000;

/** The number of Runtime Schedules that need a person, for the badge on the Schedules item. While the
 *  Schedules view is open its own 5 s list poll keeps the store current, so this reads nothing then.
 *  Everywhere else it re-reads the list once a minute, like Available and History do. */
export function useScheduleAttention(wcId: string, active: XoView): number {
  const setAll = useScheduleAttentionStore((s) => s.setAll);
  const { view } = usePolledView(
    active === 'schedules' ? null : `schedule-attention:${wcId}`,
    () => schedules.listRuntimes(wcId), 'Loading schedules failed', REFRESH_MS,
  );
  useEffect(() => { if (view) setAll(wcId, view); }, [view, wcId, setAll]);
  return useScheduleAttentionStore((s) => scheduleAttentionCount(s, wcId));
}
