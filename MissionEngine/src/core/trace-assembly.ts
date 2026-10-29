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
// assembleReferenceTrace (Task 12 review, finding I3 — see task-13-brief.md's ledger note),
// promoted out of src/conformance/harness.ts (Task 17 binding ruling): the engine writes child
// trace rows LIVE-INTERLEAVED with sibling root-level work (one step per unit of work, root+
// child step_instance rows sharing one FIFO queue — loop.ts/transition.ts's processReadyStep).
// The REFERENCE is fully synchronous per WorkflowEngine instance: `completeChildWorkflow`
// (engine.ts:725-758) splices the ENTIRE child trace (`this.trace.push(...childEngine.getTrace())`)
// onto the parent's own trace array in ONE shot, immediately BEFORE the parent WORKFLOW PROXY
// step's own COMPLETED entry — regardless of when, chronologically, the child's individual steps
// actually executed relative to sibling branches. A still-ACTIVE (never-completed) child is
// instead appended at the very END of its owning context's own trace (`getTrace()`, engine.ts:
// 452-457) — "children-last while active".
//
// Reconstructing this from raw trace_entry rows needs three things NONE of which live on the row
// alone: (1) which spec (root or a nested child, at any depth) recorded a given row — trace_entry
// carries no node_oid column, so this is derived by walking the STATIC spec tree once (step oids
// are globally unique across the whole tree by construction — deepCopySpec mints fresh oids for
// every cloned child); (2) each context's OWN chronological order, given by its own per-context
// order_index counter (context.ts's recordTrace) — insertion id is only a tie-breaker; (3) which
// WORKFLOW PROXY steps spawn which child spec (by local_id, matching activateWorkflowProxy's own
// lookup), so a proxy's COMPLETED row is recognized as a splice point.
//
// Task 17 binding ruling (task-17-brief.md's "TRACE MERGE ORDER" note): raw insertion order
// DIVERGES from this merged order whenever a parent traces DURING a child's execution — the
// terminal-history assembler (core/context.ts's settleTerminal) MUST reuse this exact function
// rather than re-deriving a different ordering; it lived here, unshared, with zero direct test
// coverage until Task 17's history tests exercised it for the first time (test/history.test.ts).
import type { MasterWorkflowSpecification, TraceEntry as SpecTraceEntry } from '../spec/types.js';
import { canonicalStepType } from './step-handlers.js';

export interface RawTraceRow {
  /** trace_entry.id — bigint identity, real insertion order. Used only as an intra-context
   *  tie-breaker; order_index is otherwise authoritative for relative position. */
  id: number;
  stepOid: string | null;
  state: string;
  orderIndex: number;
  error?: string | null;
  afterAction?: number | null;
  at: Date;
}

function collectSpecMaps(
  spec: MasterWorkflowSpecification,
  nodeOfStep: Map<string, string>,
  proxyChild: Map<string, string>,
  specByOid: Map<string, MasterWorkflowSpecification>,
): void {
  specByOid.set(spec.oid, spec);
  for (const s of spec.steps) {
    nodeOfStep.set(s.oid, spec.oid);
    if (canonicalStepType(s.step_type) === 'WORKFLOW PROXY') {
      const child = spec.children?.find(c => c.local_id === s.local_id);
      if (child) proxyChild.set(s.oid, child.oid);
    }
  }
  for (const child of spec.children ?? []) collectSpecMaps(child, nodeOfStep, proxyChild, specByOid);
}

export function assembleReferenceTrace(rows: RawTraceRow[], rootSpec: MasterWorkflowSpecification): SpecTraceEntry[] {
  const nodeOfStep = new Map<string, string>();
  const proxyChild = new Map<string, string>();
  const specByOid = new Map<string, MasterWorkflowSpecification>();
  collectSpecMaps(rootSpec, nodeOfStep, proxyChild, specByOid);

  const byNode = new Map<string, RawTraceRow[]>();
  for (const row of rows) {
    // A null-stepOid row (instance-level ERRORED — invalid-spec-at-start, or loop.ts's generic
    // per-instance settle) is only ever recorded via the ROOT context (instance.ts/loop.ts never
    // hold a child context) — defaults to the root spec's own oid.
    const nodeOid = (row.stepOid && nodeOfStep.get(row.stepOid)) || rootSpec.oid;
    let list = byNode.get(nodeOid);
    if (!list) { list = []; byNode.set(nodeOid, list); }
    list.push(row);
  }
  for (const list of byNode.values()) {
    list.sort((a, b) => (a.orderIndex - b.orderIndex) || (a.id - b.id));
  }

  function toEntry(row: RawTraceRow): SpecTraceEntry {
    const entry: SpecTraceEntry = { step_oid: row.stepOid ?? '', state: row.state, order: row.orderIndex, timestamp: row.at.getTime() };
    if (row.afterAction !== undefined && row.afterAction !== null) entry.after_action = row.afterAction;
    if (row.error) entry.error = row.error;
    return entry;
  }

  function assembleNode(nodeOid: string, consumed: Set<string>): SpecTraceEntry[] {
    const own = byNode.get(nodeOid) ?? [];
    const result: SpecTraceEntry[] = [];
    for (const row of own) {
      if (row.state === 'COMPLETED' && row.stepOid) {
        const childOid = proxyChild.get(row.stepOid);
        if (childOid !== undefined && !consumed.has(childOid) && byNode.has(childOid)) {
          consumed.add(childOid);
          result.push(...assembleNode(childOid, consumed));
        }
      }
      result.push(toEntry(row));
    }
    // Still-active children spawned from a proxy step owned by THIS node, never completed (no
    // COMPLETED row consumed them above): reference getTrace()'s "children-last while active" —
    // appended at the end of THIS context's own trace. Task 13 post-review (M5 fix): ordered by
    // ACTIVATION order, not spec declaration order — the reference iterates
    // `this.activeChildEngines.values()` (a Map, so insertion/activation order), and spec
    // declaration order does NOT reliably match that (e.g. a PARALLEL's second-declared branch
    // can still be the FIRST one actually activated, depending on BFS timing — the very
    // divergence Task 13's I1 fix addresses in the live engine). Raw trace rows carry no
    // explicit "activation order" field, but each still-active child's OWN earliest row `id`
    // (real insertion order) is a faithful proxy for when it was first activated.
    const stillActiveChildOids = new Set<string>();
    for (const s of specByOid.get(nodeOid)?.steps ?? []) {
      const childOid = proxyChild.get(s.oid);
      if (childOid !== undefined && !consumed.has(childOid) && byNode.has(childOid)) {
        stillActiveChildOids.add(childOid);
      }
    }
    const orderedStillActive = [...stillActiveChildOids].sort((a, b) => {
      const aFirstId = Math.min(...byNode.get(a)!.map(r => r.id));
      const bFirstId = Math.min(...byNode.get(b)!.map(r => r.id));
      return aFirstId - bFirstId;
    });
    for (const childOid of orderedStillActive) {
      consumed.add(childOid);
      result.push(...assembleNode(childOid, consumed));
    }
    return result;
  }

  return assembleNode(rootSpec.oid, new Set());
}
