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
//
// The work-center-shared value-property tier (spec §5.6, user decision U5: live shared,
// read-through and write-through).
//
// One instance of this class is shared BY REFERENCE across a root WorkflowContext and every
// child view, exactly as the ResourceManager is — a child writing a shared value must be
// visible to its parent within the same transition, and to every other running workflow in the
// work center on its next read.
import type { SharedValueRow } from 'mission-control-db/src/runtime/wc-value-properties';

const SEP = '.';

/** Split "Prop.Entry" on the FIRST separator. Entry names may contain dots; property names,
 *  which back a composite primary key, are matched whole. */
function splitDotKey(dotKey: string): { propertyName: string; entryName: string } | null {
  const at = dotKey.indexOf(SEP);
  if (at <= 0 || at === dotKey.length - 1) return null;
  return { propertyName: dotKey.slice(0, at), entryName: dotKey.slice(at + 1) };
}

export class SharedPropertyTier {
  private values = new Map<string, string>();          // "Prop.Entry" -> value
  private dirty = new Set<string>();                    // "Prop.Entry" pending flush

  static fromRows(rows: SharedValueRow[]): SharedPropertyTier {
    const tier = new SharedPropertyTier();
    for (const r of rows) tier.values.set(`${r.propertyName}${SEP}${r.entryName}`, r.value);
    return tier;
  }

  /** Exact-pair membership. Write routing keys on THIS, not on the property name alone
   *  (plan delta D5): routing on the name would send a write to an entry the registry has no
   *  row for, where the UPDATE matches nothing and the value silently vanishes. */
  has(dotKey: string): boolean {
    return this.values.has(dotKey);
  }

  get(dotKey: string): string | undefined {
    return this.values.get(dotKey);
  }

  /** Mutates in place and marks the entry for flush. Every store sharing this tier sees it
   *  immediately — that is the point. */
  set(dotKey: string, value: string): void {
    this.values.set(dotKey, value);
    this.dirty.add(dotKey);
  }

  /** All entries of one property, for the group-prefix merge. The `Description` entry is
   *  excluded here for the same reason properties.ts excludes it locally: it is human
   *  annotation, not runtime data, and must never surface in a serialized group read. */
  entriesUnder(propertyName: string): Array<{ name: string; value: string }> {
    const prefix = `${propertyName}${SEP}`;
    const out: Array<{ name: string; value: string }> = [];
    for (const [key, value] of this.values) {
      if (!key.startsWith(prefix)) continue;
      const name = key.slice(prefix.length);
      if (name.toLowerCase() === 'description') continue;
      out.push({ name, value });
    }
    return out;
  }

  /** Every entry, for the history merge (plan delta D6). Includes Description — history is a
   *  record of state, not a group read. */
  allEntries(): Array<{ dotKey: string; value: string }> {
    return [...this.values].map(([dotKey, value]) => ({ dotKey, value }));
  }

  /** Drain the pending writes. Draining is deliberate: persist() may run more than once in a
   *  transition, and a value already flushed must not be written again.
   *
   *  M3 fix: sorted by (propertyName, entryName) before returning — NOT cosmetic. This matches
   *  loadSharedValueProperties's own ORDER BY and the table's primary key order, so two
   *  concurrent transitions that dirty the same two keys in opposite orders always take their
   *  per-row UPDATE locks in the SAME order, closing a deadlock window that draining a Set (which
   *  iterates in dirty-insertion order) left open. A future reader tempted to drop this sort as
   *  "just for determinism/readability" would reopen that window. */
  takeDirty(): Array<{ propertyName: string; entryName: string; value: string }> {
    const out: Array<{ propertyName: string; entryName: string; value: string }> = [];
    for (const dotKey of this.dirty) {
      const split = splitDotKey(dotKey);
      if (!split) continue;
      out.push({ ...split, value: this.values.get(dotKey) ?? '' });
    }
    this.dirty.clear();
    out.sort((a, b) => a.propertyName.localeCompare(b.propertyName) || a.entryName.localeCompare(b.entryName));
    return out;
  }
}
