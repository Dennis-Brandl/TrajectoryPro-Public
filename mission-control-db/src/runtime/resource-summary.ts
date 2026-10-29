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

// One home for the resource summary vocabulary (spec §6.1). The engine's
// InMemoryResourceManager.getSnapshot() and the Mission Commander's read DAOs both render the
// same strings — "Free", "In use", "2/3 in use", "4 available, 1 in use",
// "send:1 recv:0 sync:0" — and before this module each side would have derived them on its
// own. Pure: no DB, no engine types. mission-control-db never imports the engine, so the
// engine calls in here (it already imports ../runtime/wc-resources the same way).

export type ResourceSummaryInput =
  | { type: 'binary exclusive use'; inUse: number; queued: number }
  | { type: 'binary shared use with pool limits'; inUse: number; useLimit: number; queued: number }
  | { type: 'countable use with pool limits'; inUse: number; useLimit: number; queued: number }
  | { type: 'named pool'; poolSize: number; available: number; queued: number }
  | { type: 'sync'; send: number; receive: number; sync: number };

export type ResourceSummary = {
  /** Capacity: use_limit, roster size, 1 (binary exclusive) or 0 (sync). */
  total: number;
  /** Held: the counter, or roster size minus free names. */
  inUse: number;
  /** total − inUse (named pool: the free names). */
  available: number;
  /** Waiting entries (sync: send + receive + sync). */
  queued: number;
  /** The human-readable summary the engine has always rendered. */
  state: string;
};

export function summarizeResource(r: ResourceSummaryInput): ResourceSummary {
  switch (r.type) {
    case 'binary exclusive use':
      // `> 0` rather than `=== 1`: the engine's counter is typed 0 | 1, but a registry row is
      // an int4 — an over-counted binary (a wedge, spec §12.3) must read "In use", not "Free".
      return { total: 1, inUse: r.inUse, available: 1 - r.inUse, queued: r.queued, state: r.inUse > 0 ? 'In use' : 'Free' };
    case 'binary shared use with pool limits':
    case 'countable use with pool limits':
      return { total: r.useLimit, inUse: r.inUse, available: r.useLimit - r.inUse, queued: r.queued, state: `${r.inUse}/${r.useLimit} in use` };
    case 'named pool': {
      const inUse = r.poolSize - r.available;
      return { total: r.poolSize, inUse, available: r.available, queued: r.queued, state: `${r.available} available, ${inUse} in use` };
    }
    case 'sync':
      return { total: 0, inUse: 0, available: 0, queued: r.send + r.receive + r.sync, state: `send:${r.send} recv:${r.receive} sync:${r.sync}` };
  }
}

/** Queue counts a registry read derives from wc_resource_waiter rows, keyed by `kind`. */
export type RegistryQueueCounts = { acquire: number; send: number; receive: number; sync: number };

/** A wc_resource row as the summary needs it. Structural, so a DAO projection and a full
 *  row both satisfy it. */
export type RegistryRowForSummary = {
  resourceType: string; inUse: number; useLimit: number | null; poolNames: string[]; availableNames: string[];
};

/** Summarize a registry row. `useLimit ?? 1` is the same default Phase 2a hydration applies:
 *  Designer omits use_limit for a count-1 countable/shared pool (schema comment on
 *  wc_resource.use_limit), so NULL means 1 there — never "unlimited". */
export function summarizeRegistryRow(row: RegistryRowForSummary, queue: RegistryQueueCounts): ResourceSummary {
  switch (row.resourceType) {
    case 'binary exclusive use':
      return summarizeResource({ type: 'binary exclusive use', inUse: row.inUse, queued: queue.acquire });
    case 'binary shared use with pool limits':
      return summarizeResource({ type: 'binary shared use with pool limits', inUse: row.inUse, useLimit: row.useLimit ?? 1, queued: queue.acquire });
    case 'countable use with pool limits':
      return summarizeResource({ type: 'countable use with pool limits', inUse: row.inUse, useLimit: row.useLimit ?? 1, queued: queue.acquire });
    case 'named pool':
      return summarizeResource({ type: 'named pool', poolSize: row.poolNames.length, available: row.availableNames.length, queued: queue.acquire });
    case 'sync':
      return summarizeResource({ type: 'sync', send: queue.send, receive: queue.receive, sync: queue.sync });
    default:
      // Unreachable through the schema: wc_resource_type_ck constrains the column to
      // RESOURCE_TYPES. Loud rather than silent if that ever changes.
      throw new Error(`summarizeRegistryRow: unknown resource type "${row.resourceType}"`);
  }
}
