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
// Task 13: conformance harness — reference parity (task-13-brief.md's exit criterion is
// PARITY, not literal 82/82: the reference runner itself fails 4 of the 82 vendored fixtures at
// the vendored commit — src/conformance/PROVENANCE.md's "Known reference failures"). One
// dynamic test per fixture across execution/, parameters/, and resources/ — validation/ stays
// covered by test/validator-conformance.test.ts (pure validate() calls, no DB). The THREE
// validation-category fixtures that live INSIDE resources/ (res-validation-00{1,2,3}) are not
// covered there; runFixture's own category dispatch (harness.ts) routes them through validate()
// here instead of seeding an instance.
import { expect, test } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTestDb } from './helpers/db.js';
import { runFixture, assembleReferenceTrace, type RawTraceRow } from '../src/conformance/harness.js';
import type { TestFixture, MasterWorkflowSpecification } from '../src/spec/types.js';

// Known reference failures (parity baseline — src/conformance/PROVENANCE.md's "Known reference
// failures" section, execution fixtures). All three involve WORKFLOW PROXY / child workflows;
// the reference repo's OWN conformance runner fails them at the vendored commit
// (fcec3987aa21f48aab1b3d6391093a2397f5dfd6) — the port must not be judged against their stale
// expectations. child-workflows.test.ts covers WORKFLOW PROXY behavior with hand-rolled specs
// instead (see its header comment).
const KNOWN_FAILURES = new Set([
  'exec-child-001-simple.json', // reference: "Trace mismatch: Trace length mismatch: expected 4, got 6"
  'exec-child-002-params.json', // reference: 'Workflow state: expected "COMPLETED", got "RUNNING"'
  'exec-child-003-user-interaction.json', // reference: "Validation failed: MISSING_REQUIRED_FIELD"
]);

const FIXTURES_ROOT = join(import.meta.dirname, '../src/conformance/fixtures');
const GRADED_DIRS = ['execution', 'parameters', 'resources'];

for (const dir of GRADED_DIRS) {
  const full = join(FIXTURES_ROOT, dir);
  const files = readdirSync(full).filter(f => f.endsWith('.json')).sort();
  for (const file of files) {
    const testFn = KNOWN_FAILURES.has(file) ? test.skip : test;
    testFn(`${dir} fixture ${file}`, async () => {
      const fixture = JSON.parse(readFileSync(join(full, file), 'utf8')) as TestFixture;
      const { db, close } = await makeTestDb();
      try {
        const result = await runFixture(db, fixture);
        if (!result.pass) throw new Error(result.detail ?? `fixture ${file} failed with no detail`);
      } finally {
        await close();
      }
    });
  }
}

// ── assembleReferenceTrace unit tests (task-13-brief.md's ledger note: "Build this as an
// EXPORTED function ... with its own unit tests — Task 17's history assembler will reuse it").
// None of the 82 vendored fixtures graded above actually exercise the splice logic (the only
// fixtures with `children` are the three exec-child-* KNOWN_FAILURES above, all skipped, plus
// one validation-category resources/ fixture that never reaches execution) — so correctness
// here rests entirely on these hand-built scenarios, matching the reference source
// (engine.ts:452-457's getTrace, 725-758's completeChildWorkflow) directly. ──

const managed = (localId: string, oid: string, extra: Record<string, unknown> = {}) => ({
  local_id: localId, oid, version: '1.0.0', last_modified_date: '2026-01-01', ...extra,
});

function row(id: number, stepOid: string | null, state: string, orderIndex: number, afterAction?: number): RawTraceRow {
  return { id, stepOid, state, orderIndex, afterAction: afterAction ?? null, error: null, at: new Date(id) };
}

test('assembleReferenceTrace: no children — passthrough in order_index order', () => {
  const spec = {
    ...managed('wf', 'root'),
    steps: [managed('s', 's1', { step_type: 'START' }), managed('e', 'e1', { step_type: 'END' })],
    connections: [{ from_step_id: 's1', to_step_id: 'e1' }],
  } as unknown as MasterWorkflowSpecification;

  const rows: RawTraceRow[] = [row(1, 's1', 'COMPLETED', 1), row(2, 'e1', 'COMPLETED', 2)];
  const result = assembleReferenceTrace(rows, spec);
  expect(result.map(e => [e.step_oid, e.state, e.order])).toEqual([['s1', 'COMPLETED', 1], ['e1', 'COMPLETED', 2]]);
});

// ── the flagged case: "a parent branch advancing while a child runs" ──
//
// Topology: START -> PARALLEL -> {USER_INTERACTION 'a-park' -> WAIT ALL 'wa'} and
// {WORKFLOW PROXY 'proxy' (child parks on its own USER_INTERACTION 'c-park') -> 'wa'} -> END.
// Submitting 'a-park' FIRST (the sibling branch advances while the child sits parked) THEN
// 'c-park' (completing the child) reproduces the exact raw-insertion-vs-reference divergence:
// in raw id order, the child's c-start/c-park(EXEC) rows land BEFORE a-park's own COMPLETED/
// wa's EXECUTING park (both were produced by the SAME processReadyStep cycle that activated the
// proxy) — but the reference splices the child's ENTIRE block immediately before 'proxy'
// COMPLETED, which only happens once c-park is submitted, chronologically AFTER a-park's own
// completion already landed in the parent's own trace array.
const CHILD_SPEC = {
  ...managed('ChildRef', 'child'),
  steps: [
    managed('c-start', 'c-start', { step_type: 'START' }),
    managed('c-park', 'c-park', { step_type: 'USER_INTERACTION' }),
    managed('c-end', 'c-end', { step_type: 'END' }),
  ],
  connections: [
    { from_step_id: 'c-start', to_step_id: 'c-park' },
    { from_step_id: 'c-park', to_step_id: 'c-end' },
  ],
};

const PARENT_SPEC = {
  ...managed('wf', 'root'),
  steps: [
    managed('s', 's1', { step_type: 'START' }),
    managed('p', 'p1', { step_type: 'PARALLEL' }),
    managed('a', 'a-park', { step_type: 'USER_INTERACTION' }),
    managed('ChildRef', 'proxy', { step_type: 'WORKFLOW PROXY' }),
    managed('wa', 'wa', { step_type: 'WAIT ALL' }),
    managed('e', 'end', { step_type: 'END' }),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 'p1' },
    { from_step_id: 'p1', to_step_id: 'a-park' },
    { from_step_id: 'p1', to_step_id: 'proxy' },
    { from_step_id: 'a-park', to_step_id: 'wa' },
    { from_step_id: 'proxy', to_step_id: 'wa' },
    { from_step_id: 'wa', to_step_id: 'end' },
  ],
  children: [CHILD_SPEC],
} as unknown as MasterWorkflowSpecification;

test('assembleReferenceTrace: a sibling branch advancing while the child runs is reordered to reference splice order', () => {
  // Raw insertion (id) order — see the fixture comment above for the derivation.
  const rows: RawTraceRow[] = [
    row(1, 's1', 'COMPLETED', 1),
    row(2, 'p1', 'COMPLETED', 2),
    row(3, 'a-park', 'EXECUTING', 3),
    row(4, 'proxy', 'EXECUTING', 4),
    row(5, 'c-start', 'COMPLETED', 1),        // child's OWN counter restarts at 1
    row(6, 'c-park', 'EXECUTING', 2),
    row(7, 'a-park', 'COMPLETED', 5, 0),      // sibling branch completes WHILE the child is parked
    row(8, 'wa', 'EXECUTING', 6),
    row(9, 'c-park', 'COMPLETED', 3, 0),      // child finally submitted
    row(10, 'c-end', 'COMPLETED', 4),
    row(11, 'proxy', 'COMPLETED', 7),
    row(12, 'wa', 'COMPLETED', 8),
    row(13, 'end', 'COMPLETED', 9),
  ];

  const result = assembleReferenceTrace(rows, PARENT_SPEC);

  // Reference order: root's own chronology up to (and including) 'wa' EXECUTING, THEN the
  // child's entire block spliced in, THEN 'proxy' COMPLETED immediately after it, then the rest.
  expect(result.map(e => e.step_oid)).toEqual([
    's1', 'p1', 'a-park', 'proxy',   // proxy EXECUTING (park)
    'a-park',                         // COMPLETED — sibling branch advanced first
    'wa',                             // EXECUTING — wa's first arrival park
    'c-start', 'c-park', 'c-park', 'c-end', // entire child block, spliced as one unit
    'proxy',                          // COMPLETED — immediately follows the splice
    'wa', 'end',
  ]);
  // Spot-check the two ambiguous 'a-park'/'proxy'/'wa' duplicate-stepOid entries by state+order.
  expect(result.map(e => [e.step_oid, e.state, e.order])).toEqual([
    ['s1', 'COMPLETED', 1], ['p1', 'COMPLETED', 2], ['a-park', 'EXECUTING', 3], ['proxy', 'EXECUTING', 4],
    ['a-park', 'COMPLETED', 5], ['wa', 'EXECUTING', 6],
    ['c-start', 'COMPLETED', 1], ['c-park', 'EXECUTING', 2], ['c-park', 'COMPLETED', 3], ['c-end', 'COMPLETED', 4],
    ['proxy', 'COMPLETED', 7], ['wa', 'COMPLETED', 8], ['end', 'COMPLETED', 9],
  ]);
});

test('assembleReferenceTrace: a still-active (never-completed) child is appended at the end — "children-last while active"', () => {
  // Same topology, but the child never finishes (c-park stays parked forever) and the sibling
  // branch's own completion is the last recorded root-level row — 'proxy' has no COMPLETED row
  // at all, so the reference's getTrace() falls back to appending the (partial) child trace at
  // the very end rather than splicing it at a specific position.
  const rows: RawTraceRow[] = [
    row(1, 's1', 'COMPLETED', 1),
    row(2, 'p1', 'COMPLETED', 2),
    row(3, 'a-park', 'EXECUTING', 3),
    row(4, 'proxy', 'EXECUTING', 4),
    row(5, 'c-start', 'COMPLETED', 1),
    row(6, 'c-park', 'EXECUTING', 2),
    row(7, 'a-park', 'COMPLETED', 5, 0),
    row(8, 'wa', 'EXECUTING', 6),
  ];

  const result = assembleReferenceTrace(rows, PARENT_SPEC);
  expect(result.map(e => e.step_oid)).toEqual([
    's1', 'p1', 'a-park', 'proxy', 'a-park', 'wa', // every root-level row, in root order
    'c-start', 'c-park',                            // the still-active child's own trace, appended last
  ]);
});
