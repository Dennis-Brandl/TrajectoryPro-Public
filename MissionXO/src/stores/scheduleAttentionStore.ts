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
import { create } from 'zustand';
import type { RuntimeScheduleView } from '@/lib/api/types';
import { needsAttention } from '@/components/schedules/schedule-format';

type Row = Pick<RuntimeScheduleView, 'id' | 'needsAttention'>;
type State = {
  /** The work center the ids below belong to. */
  wcId: string | null;
  /** Ids of this work center's Runtime Schedules that have something failed, lost or missed. */
  flagged: string[];
  setAll: (wcId: string, rows: Row[]) => void;
  setOne: (wcId: string, row: Row) => void;
};

/** How many Runtime Schedules need a person, for the badge on the Schedules item. Whoever just read
 *  the schedules (the list while it is open, the detail, a slow poll elsewhere) writes it here. */
export const useScheduleAttentionStore = create<State>((set) => ({
  wcId: null,
  flagged: [],
  setAll: (wcId, rows) => set({ wcId, flagged: rows.filter(needsAttention).map((r) => r.id) }),
  setOne: (wcId, row) => set((s) => {
    const others = s.wcId === wcId ? s.flagged.filter((id) => id !== row.id) : [];
    return { wcId, flagged: needsAttention(row) ? [...others, row.id] : others };
  }),
}));

export const scheduleAttentionCount = (s: Pick<State, 'wcId' | 'flagged'>, wcId: string): number =>
  s.wcId === wcId ? s.flagged.length : 0;
