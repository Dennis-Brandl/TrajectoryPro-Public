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

import { eq } from 'drizzle-orm';
import { workflow, workflowInstance } from '../db/schema/index.js';
import type { Schema } from '../db/client.js';
import type { PgDatabase } from 'drizzle-orm/pg-core';

type Db = PgDatabase<any, Schema>;

export type Notation = 'flowchart' | 'bpmn' | 'isa88';

export type DiagramStep = {
  oid: string; name: string; stepType: string;
  x: number; y: number;
  /** The child spec this step descends into, or null. Resolved by name — see below. */
  childSpecOid: string | null;
  /** A GATE whose gate_config.mode is timer or condition_or_timer — drawn with a clock mark. */
  timedGate?: true;
};
export type DiagramConnection = {
  fromStepOid: string; toStepOid: string;
  condition: string | null;
  waypoints: { x: number; y: number }[] | null;
  sourceHandleId: string | null;
};
export type DiagramSpec = {
  oid: string; name: string; version: string | null; state: string | null;
  notation: Notation;
  steps: DiagramStep[];
  connections: DiagramConnection[];
  children: DiagramSpec[];
};
export type WorkflowDiagram = { workflowId: string; root: DiagramSpec };

const NOTATIONS: Notation[] = ['flowchart', 'bpmn', 'isa88'];

// spec_jsonb cannot encode a cycle (it's plain JSON), but nothing stops an uploaded package
// from nesting children hundreds of levels deep. Without a cap, projectSpec's recursion
// blows the call stack (RangeError) on a small, perfectly valid JSON document — a real way
// this file could throw despite every field-level check below. Real Designer workflows nest a
// handful of levels; 50 is far beyond any legitimate document. Past the cap, the node at
// that depth is still projected but its OWN children are truncated to [] rather than
// recursed into — so the returned tree is a real (if incomplete) prefix of the spec, not a
// crash. A caller must not mistake a truncated tree for a complete one.
const MAX_SPEC_DEPTH = 50;

// Designer's own importer fallback for steps an older package saved without geometry
// (workflow-importers.ts). Mirrored verbatim so a Mission Commander fallback layout matches
// what Designer would draw for the same file.
function fallbackPosition(index: number) {
  return { x: 100 + (index % 5) * 200, y: 100 + Math.floor(index / 5) * 150 };
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
function isTimedGate(gateConfig: unknown): boolean {
  const mode = (gateConfig as Record<string, unknown> | null | undefined)?.mode;
  return mode === 'timer' || mode === 'condition_or_timer';
}
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function projectWaypoints(v: unknown): { x: number; y: number }[] | null {
  if (!Array.isArray(v)) return null;
  const pts = v
    .map((p) => {
      const o = p as Record<string, unknown> | null;
      const x = num(o?.x), y = num(o?.y);
      return x === null || y === null ? null : { x, y };
    })
    .filter((p): p is { x: number; y: number } => p !== null);
  return pts.length ? pts : null;
}

/**
 * Project one spec node (and, recursively, its children) into the diagram shape.
 *
 * `spec` is an arbitrary JSON value read straight out of spec_jsonb, which was written
 * verbatim from an uploaded package. Nothing here may throw and nothing may assume a field
 * exists: a malformed spec must produce an empty or partial diagram, never a 500 and never
 * a client-side crash. (A prior release shipped a blank SPA because an unvalidated array
 * from an uploaded package reached .map() with no ErrorBoundary above it.)
 *
 * PROXY LINKAGE. The WFmaster format carries no pointer from a WORKFLOW PROXY step to the
 * child spec it embeds — Designer itself rebuilds it by matching step.local_id to
 * children[].local_id, and the runtime engine does the same. We inherit that rule, so a
 * workflow whose match fails here also fails in Designer. When several children share a
 * local_id the FIRST claims the step; the rest stay in children[] with no inbound step and
 * the renderer surfaces them separately, so no child becomes unreachable. A proxy step with
 * no local_id of its own never matches anything (not even a child literally named after the
 * display placeholder below) — it always gets childSpecOid: null.
 *
 * DEPTH. `depth` counts levels from the root (0). Recursion stops past MAX_SPEC_DEPTH: the
 * node at the cap is still returned, but with children: [] — see the constant's comment.
 *
 * Exported for direct unit testing. The depth cap used to be proven by seeding a
 * 2300-level chain through drizzle and reading it back, which wedged the test between two
 * unrelated, V8-version-dependent stack ceilings; calling this function directly removes
 * the driver from the equation entirely.
 */
export function projectSpec(spec: unknown, depth = 0): DiagramSpec {
  const s = (spec ?? {}) as Record<string, unknown>;

  const children = depth >= MAX_SPEC_DEPTH
    ? []
    : arr(s.children).map((c) => projectSpec(c, depth + 1));

  // First child per local_id wins; later duplicates are left unlinked.
  const childByName = new Map<string, string>();
  for (const raw of arr(s.children)) {
    const name = str((raw as Record<string, unknown> | null)?.local_id);
    const oid = str((raw as Record<string, unknown> | null)?.oid);
    if (name && oid && !childByName.has(name)) childByName.set(name, oid);
  }

  const steps: DiagramStep[] = [];
  arr(s.steps).forEach((raw) => {
    const step = (raw ?? {}) as Record<string, unknown>;
    const oid = str(step.oid);
    if (!oid) return; // a step with no identity cannot be drawn or connected
    // localId (raw, possibly null) drives the proxy-child lookup; name is display-only and
    // must NOT be used as the lookup key — defaulting it to a placeholder before the lookup
    // would let a local_id-less proxy spuriously match a child literally named that
    // placeholder, and would collapse every such proxy onto the same child.
    const localId = str(step.local_id);
    const name = localId ?? '(unnamed step)';
    const stepType = str(step.step_type) ?? 'UNKNOWN';
    const pos = (step.position ?? null) as Record<string, unknown> | null;
    const x = num(pos?.x), y = num(pos?.y);
    const fallback = fallbackPosition(steps.length);
    steps.push({
      oid, name, stepType,
      x: x ?? fallback.x,
      y: y ?? fallback.y,
      childSpecOid: stepType === 'WORKFLOW PROXY' && localId ? (childByName.get(localId) ?? null) : null,
      ...(stepType === 'GATE' && isTimedGate(step.gate_config) ? { timedGate: true as const } : {}),
    });
  });

  const connections: DiagramConnection[] = [];
  for (const raw of arr(s.connections)) {
    const c = (raw ?? {}) as Record<string, unknown>;
    const from = str(c.from_step_id), to = str(c.to_step_id);
    if (!from || !to) continue;
    connections.push({
      fromStepOid: from, toStepOid: to,
      condition: str(c.condition),
      waypoints: projectWaypoints(c.waypoints),
      sourceHandleId: str(c.source_handle_id),
    });
  }

  const declared = str(s.display_style) as Notation | null;
  return {
    oid: str(s.oid) ?? '',
    name: str(s.local_id) ?? '(unnamed)',
    version: str(s.version),
    state: str(s.state),
    notation: declared && NOTATIONS.includes(declared) ? declared : 'flowchart',
    steps, connections, children,
  };
}

/**
 * The Diagram tab's payload: the workflow's step graph, recursively including embedded
 * child specs. undefined = no such workflow.
 *
 * Selects ONLY spec_jsonb, and ships the whole tree in one response — specs run a few KB,
 * so per-level fetches would add latency without saving bandwidth.
 */
export async function workflowDiagram(db: Db, workflowId: string): Promise<WorkflowDiagram | undefined> {
  const [row] = await db.select({ spec: workflow.specJsonb }).from(workflow)
    .where(eq(workflow.id, workflowId)).limit(1);
  if (!row) return undefined;
  return { workflowId, root: projectSpec(row.spec) };
}

/** The Workflows tab's static payload (spec 2026-08-19 §1.2): the INSTANCE's frozen
 *  recipe projected to geometry. Step oids here are the rt_N oids that step_instance
 *  rows carry, so live states join client-side with no oid bridging. Same projection
 *  guard as workflowDiagram(): nothing but projectSpec's output leaves. */
export type RuntimeWorkflowDiagram = {
  instanceId: string; runtimeNumber: number; runtimeLabel: string; masterName: string; root: DiagramSpec;
};

export async function getRuntimeWorkflowDiagram(db: Db, instanceId: string): Promise<RuntimeWorkflowDiagram | undefined> {
  const [row] = await db.select({
    id: workflowInstance.id, runtimeNumber: workflowInstance.runtimeNumber, runtimeLabel: workflowInstance.runtimeLabel,
    masterName: workflowInstance.masterName, spec: workflowInstance.specJsonb,
  }).from(workflowInstance).where(eq(workflowInstance.id, instanceId)).limit(1);
  if (!row) return undefined;
  return { instanceId: row.id, runtimeNumber: row.runtimeNumber, runtimeLabel: row.runtimeLabel, masterName: row.masterName, root: projectSpec(row.spec) };
}
