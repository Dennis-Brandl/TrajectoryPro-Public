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

export type WorkCenterGroup<T> = { workCenterId: string; workCenterName: string; items: T[] };

/**
 * Group artifact entries under their owning work center, for the 2-level
 * work-center → entry-leaf trees. Generic over the entry type so the Workflow and
 * Environment trees share one implementation.
 *
 * M6 replaced groupByLibrary with this: the container is now OWNERSHIP, not filing. Groups
 * are ordered by work-center name; items keep the order the server gave them (the list
 * routes already sort by (workCenter.name, name, version, state)), so this deliberately
 * never re-sorts items — doing so would mask a server-side ordering regression.
 *
 * Only work centers holding at least one entry appear, and that is CORRECT: an empty work
 * center is visible in the Work Centers hierarchy, and rendering it as an empty header in
 * the Workflow tree would be noise.
 */
export function groupByWorkCenter<T extends { workCenterId: string; workCenterName: string }>(
  items: T[],
): WorkCenterGroup<T>[] {
  const byId = new Map<string, WorkCenterGroup<T>>();
  for (const item of items) {
    let group = byId.get(item.workCenterId);
    if (!group) {
      group = { workCenterId: item.workCenterId, workCenterName: item.workCenterName, items: [] };
      byId.set(item.workCenterId, group);
    }
    group.items.push(item);
  }
  return [...byId.values()].sort((a, b) => a.workCenterName.localeCompare(b.workCenterName));
}
