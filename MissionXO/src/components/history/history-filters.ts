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
import type { RuntimeHistoryFinalState } from '@/lib/api/types';

export type HistoryFilters = { from: string; to: string; state?: RuntimeHistoryFinalState; search?: string };

const pad = (n: number) => String(n).padStart(2, '0');

/** Last 7 days: from local midnight seven days before `now`, as a datetime-local string; no end. */
export function defaultHistoryFilters(now: Date): HistoryFilters {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
  return { from: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T00:00`, to: '' };
}

export const RESULT_OPTIONS: Array<{ value: RuntimeHistoryFinalState | ''; label: string }> = [
  { value: '', label: 'All results' },
  { value: 'completed', label: 'Completed' },
  { value: 'errored', label: 'Failed' },
  { value: 'stopped', label: 'Stopped' },
  { value: 'aborted', label: 'Aborted' },
];

/** "Today", "Yesterday" or a date, by local calendar day. */
export function dayLabel(iso: string, now: Date): string {
  const d = new Date(iso);
  const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return d.toLocaleDateString([], { dateStyle: 'medium' });
}
