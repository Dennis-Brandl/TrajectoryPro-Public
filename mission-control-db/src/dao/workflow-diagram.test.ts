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

import { expect, test } from 'vitest';
import { makeTestDb } from '../../test/helpers/db.js';
import { runtimeCols } from '../../test/helpers/instances.js';
import { workCenter, workflow, workflowInstance } from '../db/schema/index.js';
import { projectSpec, workflowDiagram, getRuntimeWorkflowDiagram } from './workflow-diagram.js';

// The name counter is load-bearing: work_center has a UNIQUE index on `name` where
// parent_work_center_id is null (work_center_root_name_uq), and the malformed-spec test
// below calls this six times against one database.
let seedCounter = 0;
async function seedSpec(db: any, spec: unknown) {
  const n = ++seedCounter;
  const [wc] = await db.insert(workCenter).values({ name: `Line ${n}` }).returning();
  const [wf] = await db.insert(workflow).values({
    oid: `wf-${n}`, name: 'Bottle Fill', workCenterId: wc.id, specJsonb: spec as any,
  }).returning();
  return wf.id;
}

const GOOD = {
  oid: 'root', local_id: 'Root', version: '1.0.0', state: 'Draft', display_style: 'bpmn',
  steps: [
    { oid: 's0', local_id: 'START', step_type: 'START', position: { x: 10, y: -20 } },
    { oid: 's1', local_id: 'Sub Task', step_type: 'WORKFLOW PROXY', position: { x: 100, y: 40 } },
  ],
  connections: [
    { from_step_id: 's0', to_step_id: 's1', condition: 'ok', waypoints: [{ x: 50, y: 0 }] },
  ],
  children: [
    { oid: 'c1', local_id: 'Sub Task', version: '1.0.0', state: 'Draft',
      steps: [{ oid: 'cs0', local_id: 'Confirm', step_type: 'YES_NO', position: { x: 5, y: 5 } }],
      connections: [], children: [] },
  ],
};

test('projects steps, connections and notation', async () => {
  const { db, close } = await makeTestDb();
  try {
    const id = await seedSpec(db, GOOD);
    const d = await workflowDiagram(db, id);
    expect(d?.workflowId).toBe(id);
    expect(d?.root).toMatchObject({ oid: 'root', name: 'Root', notation: 'bpmn' });
    expect(d?.root.steps).toHaveLength(2);
    expect(d?.root.steps[0]).toMatchObject({ oid: 's0', name: 'START', stepType: 'START', x: 10, y: -20 });
    expect(d?.root.connections[0]).toMatchObject({
      fromStepOid: 's0', toStepOid: 's1', condition: 'ok', waypoints: [{ x: 50, y: 0 }],
    });
  } finally { await close(); }
});

test('links a WORKFLOW PROXY step to the child sharing its local_id', async () => {
  const { db, close } = await makeTestDb();
  try {
    const d = await workflowDiagram(db, await seedSpec(db, GOOD));
    expect(d?.root.steps.find((s) => s.oid === 's1')?.childSpecOid).toBe('c1');
    expect(d?.root.steps.find((s) => s.oid === 's0')?.childSpecOid).toBeNull();
    expect(d?.root.children).toHaveLength(1);
    expect(d?.root.children[0]).toMatchObject({ oid: 'c1', name: 'Sub Task', notation: 'flowchart' });
  } finally { await close(); }
});

test('with duplicate child local_ids only the first links', async () => {
  const { db, close } = await makeTestDb();
  try {
    const spec = { ...GOOD, children: [
      { ...GOOD.children[0], oid: 'c1' },
      { ...GOOD.children[0], oid: 'c2' },
    ] };
    const d = await workflowDiagram(db, await seedSpec(db, spec));
    expect(d?.root.steps.find((s) => s.oid === 's1')?.childSpecOid).toBe('c1');
    expect(d?.root.children.map((c) => c.oid)).toEqual(['c1', 'c2']);
  } finally { await close(); }
});

test('a proxy step with no matching child gets a null childSpecOid', async () => {
  const { db, close } = await makeTestDb();
  try {
    const d = await workflowDiagram(db, await seedSpec(db, { ...GOOD, children: [] }));
    expect(d?.root.steps.find((s) => s.oid === 's1')?.childSpecOid).toBeNull();
  } finally { await close(); }
});

test('an absent or unrecognised display_style falls back to flowchart', async () => {
  const { db, close } = await makeTestDb();
  try {
    const a = await workflowDiagram(db, await seedSpec(db, { ...GOOD, display_style: undefined }));
    expect(a?.root.notation).toBe('flowchart');
    const b = await workflowDiagram(db, await seedSpec(db, { ...GOOD, display_style: 'crayon' }));
    expect(b?.root.notation).toBe('flowchart');
  } finally { await close(); }
});

test('a step without a position projects x/y as null-free numbers via the caller fallback', async () => {
  const { db, close } = await makeTestDb();
  try {
    const spec = { ...GOOD, steps: [{ oid: 's0', local_id: 'A', step_type: 'START' }] };
    const d = await workflowDiagram(db, await seedSpec(db, spec));
    // Index-based fallback mirrors Designer's own importer: 100 + (i % 5) * 200, 100 + floor(i/5) * 150
    expect(d?.root.steps[0]).toMatchObject({ x: 100, y: 100 });
  } finally { await close(); }
});

test('malformed specs degrade instead of throwing', async () => {
  const { db, close } = await makeTestDb();
  try {
    type Diagram = NonNullable<Awaited<ReturnType<typeof workflowDiagram>>>;
    // Each case asserts the outer shape stays array-typed AND the specific field-level rule
    // that should have fired — shape-only checks would stay green even if the underlying
    // drop/fallback/filter logic they're supposed to cover were deleted.
    const cases: { spec: unknown; check: (d: Diagram) => void }[] = [
      {
        spec: {},
        check: (d) => {
          expect(d.root.steps).toEqual([]);
          expect(d.root.connections).toEqual([]);
          expect(d.root.children).toEqual([]);
        },
      },
      {
        spec: { oid: 'r', local_id: 'R', steps: 'not-an-array', connections: null, children: 7 },
        check: (d) => {
          expect(d.root.steps).toEqual([]);
          expect(d.root.connections).toEqual([]);
          expect(d.root.children).toEqual([]);
        },
      },
      {
        // a step with no oid cannot be drawn or connected — it must be dropped outright,
        // not kept in the array as a bogus, id-less entry.
        spec: { oid: 'r', local_id: 'R', steps: [{ local_id: 'no oid', step_type: 'START' }], connections: [] },
        check: (d) => expect(d.root.steps).toHaveLength(0),
      },
      {
        // a non-finite position must not propagate; it falls back to the index grid.
        spec: { oid: 'r', local_id: 'R', steps: [{ oid: 'a', local_id: 'A', step_type: 'START', position: { x: 'NaN', y: null } }], connections: [] },
        check: (d) => expect(d.root.steps[0]).toMatchObject({ oid: 'a', x: 100, y: 100 }),
      },
      {
        // a connection missing to_step_id is unusable and must be dropped, not kept half-formed.
        spec: { oid: 'r', local_id: 'R', steps: [], connections: [{ from_step_id: 'a' }] },
        check: (d) => expect(d.root.connections).toHaveLength(0),
      },
      {
        // a garbage waypoint entry is filtered out; with none left, waypoints reports null
        // rather than an array of holes.
        spec: { oid: 'r', local_id: 'R', steps: [], connections: [{ from_step_id: 'a', to_step_id: 'b', waypoints: [{ x: 'x' }] }] },
        check: (d) => expect(d.root.connections[0].waypoints).toBeNull(),
      },
    ];
    for (const { spec, check } of cases) {
      const d = await workflowDiagram(db, await seedSpec(db, spec));
      expect(d).toBeDefined();
      expect(Array.isArray(d!.root.steps)).toBe(true);
      expect(Array.isArray(d!.root.connections)).toBe(true);
      expect(Array.isArray(d!.root.children)).toBe(true);
      check(d!);
    }
  } finally { await close(); }
});

test('projectSpec truncates children past the depth cap instead of throwing', () => {
  // Direct call — no database, no drizzle jsonb binding. The old version of this test
  // seeded a 2300-level chain because that number sat between drizzle's serialization
  // stack ceiling and projectSpec's own; both are V8-dependent, so the constant was one
  // Node upgrade away from flaking. Nothing here depends on stack depth at all.
  const CHAIN = 200;
  let node: any = { oid: 'leaf', local_id: 'Leaf', steps: [], connections: [], children: [] };
  for (let i = CHAIN; i >= 1; i--) {
    node = { oid: `n${i}`, local_id: `N${i}`, steps: [], connections: [], children: [node] };
  }

  const root = projectSpec(node);

  let cur = root;
  let levels = 0;
  while (cur.children.length > 0) { cur = cur.children[0]; levels++; }
  expect(levels).toBe(50);
});

test('projectSpec still returns the node AT the cap, with its own children emptied', () => {
  // The cap truncates children, it does not drop the capped node — the returned tree must
  // be a real prefix of the input, which is what lets a caller reason about it at all.
  let node: any = { oid: 'leaf', local_id: 'Leaf', steps: [], connections: [], children: [] };
  for (let i = 60; i >= 1; i--) {
    node = { oid: `n${i}`, local_id: `N${i}`, steps: [], connections: [], children: [node] };
  }
  let cur = projectSpec(node);
  for (let i = 0; i < 50; i++) cur = cur.children[0];
  expect(cur.oid).toBe('n51');       // depth 50 counting the root as 0
  expect(cur.children).toEqual([]);
});

test('a WORKFLOW PROXY step with no local_id never matches a child, even one sharing the display placeholder', async () => {
  const { db, close } = await makeTestDb();
  try {
    const spec = {
      oid: 'root', local_id: 'Root', steps: [
        { oid: 's9', step_type: 'WORKFLOW PROXY', position: { x: 0, y: 0 } }, // no local_id
      ],
      connections: [],
      children: [
        // Named exactly what the implementation defaults a nameless step's display name to.
        // A local_id-less proxy must NOT resolve against this via that placeholder.
        { oid: 'sentinel-child', local_id: '(unnamed step)', steps: [], connections: [], children: [] },
      ],
    };
    const d = await workflowDiagram(db, await seedSpec(db, spec));
    expect(d?.root.steps.find((s) => s.oid === 's9')?.childSpecOid).toBeNull();
  } finally { await close(); }
});

test('returns undefined for an unknown workflow', async () => {
  const { db, close } = await makeTestDb();
  try {
    expect(await workflowDiagram(db, '00000000-0000-0000-0000-000000000000')).toBeUndefined();
  } finally { await close(); }
});

test('projectSpec carries source_handle_id through as sourceHandleId', () => {
  const d = projectSpec({
    oid: 'r', local_id: 'R',
    steps: [
      { oid: 'g', local_id: 'Gate', step_type: 'YES_NO', position: { x: 0, y: 0 } },
      { oid: 'e', local_id: 'End', step_type: 'END', position: { x: 0, y: 200 } },
    ],
    connections: [{ from_step_id: 'g', to_step_id: 'e', source_handle_id: 'yes' }],
  });
  expect(d.connections[0]).toMatchObject({ fromStepOid: 'g', toStepOid: 'e', sourceHandleId: 'yes' });
});

test('getRuntimeWorkflowDiagram projects the INSTANCE spec_jsonb (rt oids), not the master', async () => {
  const { db, close } = await makeTestDb();
  const [wc] = await db.insert(workCenter).values({ name: `WC-${Math.random()}` }).returning();
  const [wf] = await db.insert(workflow).values({
    oid: 'm-1', name: 'M', workCenterId: wc.id, version: '1.0.0', state: 'Effective',
    specJsonb: { oid: 'm-1', local_id: 'M', steps: [], connections: [] },
  }).returning();
  const instSpec = {
    oid: 'rt_0', local_id: 'M', display_style: 'flowchart',
    steps: [
      { oid: 'rt_1', local_id: 'Begin', step_type: 'START', position: { x: 10, y: 20 } },
      { oid: 'rt_2', local_id: 'Sub', step_type: 'WORKFLOW PROXY', position: { x: 10, y: 120 } },
    ],
    connections: [{ from_step_id: 'rt_1', to_step_id: 'rt_2', waypoints: [{ x: 5, y: 0 }] }],
    children: [{ oid: 'rt_3', local_id: 'Sub', steps: [{ oid: 'rt_4', local_id: 'Inner', step_type: 'START', position: { x: 0, y: 0 } }], connections: [] }],
  };
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'running',
    specJsonb: instSpec, runtimeNumber: 7, runtimeLabel: 'RW-7', masterName: 'M', masterOid: 'm-1',
    masterVersion: '1.0.0', masterState: 'Effective',
  }).returning();

  const d = (await getRuntimeWorkflowDiagram(db, wi.id))!;
  expect(d.instanceId).toBe(wi.id);
  expect(d.runtimeNumber).toBe(7);
  expect(d.runtimeLabel).toBe('RW-7');
  expect(d.masterName).toBe('M');
  expect(d.root.steps.map((s) => s.oid)).toEqual(['rt_1', 'rt_2']);
  expect(d.root.steps[1].childSpecOid).toBe('rt_3');
  expect(d.root.connections[0].waypoints).toEqual([{ x: 5, y: 0 }]);
  expect(d.root.children[0].steps[0].oid).toBe('rt_4');
  // Only the projection leaves — no spec_jsonb keys beyond the DiagramSpec shape.
  expect(Object.keys(d).sort()).toEqual(['instanceId', 'masterName', 'root', 'runtimeLabel', 'runtimeNumber']);
  expect(await getRuntimeWorkflowDiagram(db, '00000000-0000-4000-8000-000000000000')).toBeUndefined();
  await close();
});

test('projectSpec marks timed gates (spec 2026-10-13 §4.4) and leaves other steps untouched', () => {
  const d = projectSpec({
    oid: 'r', local_id: 'R', steps: [
      { oid: 'a', local_id: 'A', step_type: 'GATE', gate_config: { mode: 'timer', delay_seconds: 5 } },
      { oid: 'b', local_id: 'B', step_type: 'GATE', gate_config: { mode: 'condition_or_timer', delay_seconds: 5 } },
      { oid: 'c', local_id: 'C', step_type: 'GATE', gate_config: { cycle_seconds: 5 } },
      { oid: 'd', local_id: 'D', step_type: 'USER_INTERACTION' },
    ], connections: [], children: [],
  } as any);
  expect(d.steps.map((s) => s.timedGate ?? false)).toEqual([true, true, false, false]);
  expect('timedGate' in d.steps[2]).toBe(false);
});
