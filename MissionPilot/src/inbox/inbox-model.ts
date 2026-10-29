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

import type { InboxTask } from '../api/types'

/** Spec §5.5 filter: step, workflow (and child workflow) or runtime ID — a case-insensitive
 *  substring match; a blank filter matches everything. */
export function matchesFilter(task: InboxTask, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const fields = [task.stepName ?? task.stepOid, task.masterName, task.runtimeLabel, ...(task.workflowPath ?? [])]
  return fields.some((f) => f.toLowerCase().includes(q))
}

/** How long a task has waited, in words: "just now", "5 min", "3 h", "2 d". A future time
 *  (engine and tablet clocks disagree) reads "just now"; an unparsable one reads blank. */
export function formatAge(iso: string, now: number): string {
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return ''
  const min = Math.floor(Math.max(0, now - at) / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} h`
  return `${Math.floor(h / 24)} d`
}

/** When the wait started: the step's last state change, else when the task was offered. */
export function waitingSince(task: InboxTask): string {
  return task.stepUpdatedAt ?? task.offeredAt
}
