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
// Task 3 (Phase 2a): openContext hydrates the work-center-shared ENVIRONMENT resource tier
// (Task 1's wc-resources DAO + Task 2's env-resource-bridge) into a fresh WorkflowContext, the
// same "construct, then load" seam Phase 2b already uses for the shared value-property tier.
// Harness reused from linear-flow.test.ts / shared-properties-lifecycle.test.ts: makeTestDb.
//
// Review fix (Important 1): the scope rule (env-scope.ts's isEnvironmentCommand) keys on
// `resource_source_oid` — the field the validator actually enforces resolves to a declared
// workflow-or-environment owner, and the field transition.ts's buildResourceKey already routes
// on — never on the OPTIONAL, advisory `resource_source_type` alone. Every fixture below that
// means to be environment-scoped therefore declares a real `environment_specifications` entry
// and points `resource_source_oid` at it, matching what a validated package actually looks like.
import { expect, test, vi } from 'vitest';
import { makeTestDb } from './helpers/db.js';
import { testDeps } from './helpers/pump.js';
import { openContext, envResourceNames } from '../src/core/context.js';
import { isEnvironmentCommand, collectEnvironmentScope } from '../src/core/env-scope.js';
import { envToken } from '../src/core/env-resource-bridge.js';
import { loadEngineState } from '../src/core/engine-state.js';
import * as wcResources from 'mission-control-db/src/runtime/wc-resources';
import {
  workCenter, workflow, workflowInstance, wcResource, wcResourceWaiter, wcResourceHolder,
} from 'mission-control-db/src/db/schema/index';
import type { MasterWorkflowSpecification } from '../src/spec/types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

function step(oid: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { local_id: oid, oid, step_type: 'MATH', version: '1.0.0', last_modified_date: '2026-01-01', ...extra };
}

// A real environment declaring 'Printer' — same shape a Designer-exported package carries.
const ENV_PRINTER = {
  local_id: 'env-printer-lib', oid: 'env-printer', version: '1.0.0', last_modified_date: '2026-01-01',
  resource_property_specifications: [{ name: 'Printer', resource_type: 'binary exclusive use' }],
};

const ENV_BAY = {
  local_id: 'env-bay-lib', oid: 'env-bay', version: '1.0.0', last_modified_date: '2026-01-01',
  resource_property_specifications: [{ name: 'Bay', resource_type: 'named pool' }],
};

async function makeWc(db: AnyDb): Promise<{ id: string }> {
  const [wc] = await db.insert(workCenter).values({ name: `wc-${Math.random()}`, path: `p${Math.random()}` }).returning();
  return wc;
}

async function makeInstance(db: AnyDb, wc: { id: string }, spec: unknown, oid: string, runtimeNumber = 1): Promise<{ id: string }> {
  const [wf] = await db.insert(workflow).values({
    workCenterId: wc.id, oid, name: oid, version: '1.0.0', state: 'Approved', specJsonb: spec,
  }).returning();
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'queued', queuedAt: new Date(),
    specJsonb: spec, startingParams: null, runtimeNumber, runtimeLabel: `RW-${runtimeNumber}`,
    masterName: oid, masterOid: oid, masterVersion: '1.0.0', masterState: 'Approved',
  }).returning();
  return wi;
}

// ── envResourceNames: pure function over a spec tree, no DB ─────────────────────────────────

test('envResourceNames picks up environment-scoped commands only', () => {
  const spec = {
    local_id: 'wf', oid: 'wf', version: '1.0.0', last_modified_date: '2026-01-01',
    environment_specifications: [ENV_PRINTER],
    steps: [
      step('s1', {
        resource_command_specifications: [
          { command_type: 'Acquire', resource_name: 'Printer', resource_source_oid: 'env-printer' },
          { command_type: 'Acquire', resource_name: 'Local' }, // no source oid -> defaults to the
          // owning spec's OWN oid ('wf'), which is not in the environment-oid set: workflow.
        ],
      }),
    ],
    connections: [],
  } as unknown as MasterWorkflowSpecification;

  expect(envResourceNames(spec)).toEqual(['Printer']);
});

// This is the regression the review caught: the first cut of this rule keyed on the OPTIONAL
// `resource_source_type` field, which every fixture in this repo's own conformance suite sets to
// "workflow" — the environment branch had zero fixture evidence. A validated package only ever
// GUARANTEES `resource_source_oid` resolves to a real owner (validator.ts's gatherOwners);
// `resource_source_type` need never be set at all. This command carries ONLY the oid.
test('a command naming only resource_source_oid (no resource_source_type at all) is still locked as environment', () => {
  const spec = {
    local_id: 'wf', oid: 'wf', version: '1.0.0', last_modified_date: '2026-01-01',
    environment_specifications: [ENV_PRINTER],
    steps: [
      step('s1', {
        resource_command_specifications: [
          { command_type: 'Acquire', resource_name: 'Printer', resource_source_oid: 'env-printer' },
        ],
      }),
    ],
    connections: [],
  } as unknown as MasterWorkflowSpecification;
  const cmds = spec.steps[0]!.resource_command_specifications!;
  expect(cmds[0]!.resource_source_type).toBeUndefined();

  expect(envResourceNames(spec)).toEqual(['Printer']);
});

test('envResourceNames reaches into child specs, including an environment the CHILD declares', () => {
  const spec = {
    local_id: 'wf', oid: 'wf', version: '1.0.0', last_modified_date: '2026-01-01',
    environment_specifications: [ENV_PRINTER],
    steps: [
      step('s1', {
        resource_command_specifications: [
          { command_type: 'Acquire', resource_name: 'Printer', resource_source_oid: 'env-printer' },
        ],
      }),
    ],
    connections: [],
    children: [
      {
        local_id: 'child', oid: 'child', version: '1.0.0', last_modified_date: '2026-01-01',
        parentChildSpecId: null, state: 'Effective',
        environment_specifications: [ENV_BAY],
        steps: [
          step('c1', {
            resource_command_specifications: [
              { command_type: 'Acquire', resource_name: 'Bay', resource_source_oid: 'env-bay' },
            ],
          }),
        ],
        connections: [],
      },
    ],
  } as unknown as MasterWorkflowSpecification;

  expect(envResourceNames(spec)).toEqual(['Bay', 'Printer']);
});

test('envResourceNames deduplicates a name acquired by more than one step', () => {
  const spec = {
    local_id: 'wf', oid: 'wf', version: '1.0.0', last_modified_date: '2026-01-01',
    environment_specifications: [ENV_PRINTER],
    steps: [
      step('s1', {
        resource_command_specifications: [
          { command_type: 'Acquire', resource_name: 'Printer', resource_source_oid: 'env-printer' },
        ],
      }),
      step('s2', {
        resource_command_specifications: [
          { command_type: 'Release', resource_name: 'Printer', resource_source_oid: 'env-printer' },
        ],
      }),
    ],
    connections: [],
  } as unknown as MasterWorkflowSpecification;

  expect(envResourceNames(spec)).toEqual(['Printer']);
});

// ── isEnvironmentCommand rule 2: a bounded, non-widening fallback ───────────────────────────

test('rule 2: an explicit resource_source_type "environment" resolves environment when resource_source_oid is absent but the name IS declared by a reachable environment spec', () => {
  const spec = {
    local_id: 'wf', oid: 'wf', version: '1.0.0', last_modified_date: '2026-01-01',
    environment_specifications: [ENV_PRINTER],
    steps: [], connections: [],
  } as unknown as MasterWorkflowSpecification;
  const scope = collectEnvironmentScope(spec);
  const cmd = { command_type: 'Acquire', resource_name: 'Printer', resource_source_type: 'environment' } as const;

  expect(isEnvironmentCommand(cmd, spec, scope)).toBe(true);
});

test('rule 2 does NOT widen routing: resource_source_type "environment" alone is not trusted for a name no reachable environment spec declares', () => {
  const spec = {
    local_id: 'wf', oid: 'wf', version: '1.0.0', last_modified_date: '2026-01-01',
    environment_specifications: [ENV_PRINTER], // declares 'Printer', not 'Ghost'
    steps: [], connections: [],
  } as unknown as MasterWorkflowSpecification;
  const scope = collectEnvironmentScope(spec);
  const cmd = { command_type: 'Acquire', resource_name: 'Ghost', resource_source_type: 'environment' } as const;

  expect(isEnvironmentCommand(cmd, spec, scope)).toBe(false);
});

// ── engine-state.ts: envHolds round-trips through loadEngineState ───────────────────────────
// Nothing else in this file would catch the loadEngineState default-list line being dropped —
// every DB-backed hydration test below passes engineState: null and then lets readHolders
// OVERWRITE state.envHolds after construction, so the suite would stay green even without it.

test('loadEngineState round-trips envHolds, and defaults it to [] for a fresh/legacy row', () => {
  const holds = [{ name: 'Printer', stepOid: 's1', amount: 1, heldName: null }];
  expect(loadEngineState({ envHolds: holds }).envHolds).toEqual(holds);
  expect(loadEngineState(null).envHolds).toEqual([]);
});

// ── openContext: DB-backed hydration ─────────────────────────────────────────────────────────

const NO_ENV_SPEC = {
  local_id: 'wf', oid: 'wf-no-env', version: '1.0.0', last_modified_date: '2026-01-01',
  steps: [step('s1'), step('s2'), step('s3')],
  connections: [],
};

const ENV_PRINTER_SPEC = {
  local_id: 'wf', oid: 'wf-env-printer', version: '1.0.0', last_modified_date: '2026-01-01',
  environment_specifications: [ENV_PRINTER],
  steps: [
    step('s1', {
      resource_command_specifications: [
        { command_type: 'Acquire', resource_name: 'Printer', resource_source_oid: 'env-printer' },
      ],
    }),
  ],
  connections: [],
};

test('openContext leaves envResources null when the recipe names no environment resources — the zero-cost path', async () => {
  const { db, close } = await makeTestDb();
  const wc = await makeWc(db);
  const wi = await makeInstance(db, wc, NO_ENV_SPEC, 'wf-no-env');

  const spy = vi.spyOn(wcResources, 'lockRegistry');
  const context = await openContext(
    db,
    { id: wi.id, workCenterId: wc.id, specJsonb: NO_ENV_SPEC, engineState: null, propertyStore: null },
    testDeps(),
  );

  expect(context.envResources).toBeNull();
  expect(context.envSnapshot).toBeNull();
  expect(context.envIndex).toBeNull();
  // The field's own doc comment promises "empty (not null) when hydration never ran".
  expect(context.envKnownNames.size).toBe(0);
  // The whole point of the null-names guard: a recipe with no environment resources never
  // takes the registry lock at all, not just that the result happens to come back empty.
  expect(spy).not.toHaveBeenCalled();
  spy.mockRestore();

  await close();
});

test('openContext hydrates counters and queue from the registry, including a foreign instance\'s waiter', async () => {
  const { db, close } = await makeTestDb();
  const wc = await makeWc(db);
  await db.insert(wcResource).values({
    workCenterId: wc.id, name: 'Printer', resourceType: 'binary exclusive use', inUse: 1,
  });

  const holder = await makeInstance(db, wc, ENV_PRINTER_SPEC, 'wf-env-printer-holder', 1);
  const foreign = await makeInstance(db, wc, ENV_PRINTER_SPEC, 'wf-env-printer-foreign', 2);
  const [waiterRow] = await db.insert(wcResourceWaiter).values({
    workCenterId: wc.id, name: 'Printer', instanceId: foreign.id, stepOid: 'c1', kind: 'acquire',
  }).returning();

  // Positive control (review minor): proves the spy is actually wired to the binding
  // openContext calls, so the OTHER test's `not.toHaveBeenCalled()` is meaningful and not just
  // an unintercepted no-op. Also directly asserts the LOCK SET openContext computed, not merely
  // the eventual hydrated outcome.
  const spy = vi.spyOn(wcResources, 'lockRegistry');
  const context = await openContext(
    db,
    { id: holder.id, workCenterId: wc.id, specJsonb: ENV_PRINTER_SPEC, engineState: null, propertyStore: null },
    testDeps(),
  );
  expect(spy).toHaveBeenCalledTimes(1);
  expect(spy).toHaveBeenCalledWith(db, wc.id, ['Printer']);
  spy.mockRestore();

  expect(context.envResources).not.toBeNull();
  const [printer] = context.envResources!.getSnapshot().filter((s) => s.name === 'Printer');
  expect(printer).toMatchObject({ total: 1, inUse: 1, available: 0, queued: 1, state: 'In use' });

  // The raw registry rows this context was hydrated from carry the foreign waiter row itself...
  expect(context.envSnapshot!.waiters).toHaveLength(1);
  expect(context.envSnapshot!.waiters[0]).toMatchObject({ instanceId: foreign.id, stepOid: 'c1', granted: false });
  // ...and its identity survived into the loaded-waiter index, which is what lets write-back
  // recognize "still queued, keep its row" and preserve this waiter's FIFO position.
  expect([...context.envIndex!.values()]).toEqual([waiterRow.id]);
  expect(context.envKnownNames.has('Printer')).toBe(true);

  // Key-space boundary (review minor): the queue entry is the INSTANCE-PREFIXED TOKEN, not a
  // bare step oid — env-resource-bridge.ts's whole reason for being a SEPARATE manager. Narrow,
  // commented private-field read, same pattern env-resource-bridge.ts's own queuedTokens() uses.
  const printerState = (context.envResources as unknown as { resources: Map<string, { queue: string[] }> })
    .resources.get('Printer');
  expect(printerState?.queue).toEqual([envToken(foreign.id, 'c1')]);
  // ...and hydration touches ONLY envResources — the workflow-scoped manager is untouched (this
  // recipe declares no workflow-scoped resource_property_specifications, so it stays null).
  expect(context.resources).toBeNull();

  await close();
});

test('openContext populates state.envHolds from the holder table, so a resumed instance knows what it already holds', async () => {
  const { db, close } = await makeTestDb();
  const wc = await makeWc(db);
  await db.insert(wcResource).values({
    workCenterId: wc.id, name: 'Printer', resourceType: 'binary exclusive use', inUse: 1,
  });

  const wi = await makeInstance(db, wc, ENV_PRINTER_SPEC, 'wf-env-printer-resumed', 1);
  await db.insert(wcResourceHolder).values({
    workCenterId: wc.id, name: 'Printer', instanceId: wi.id, stepOid: 's1', amount: 1, heldName: null,
  });

  const context = await openContext(
    db,
    { id: wi.id, workCenterId: wc.id, specJsonb: ENV_PRINTER_SPEC, engineState: null, propertyStore: null },
    testDeps(),
  );

  expect(context.state.envHolds).toEqual([
    { name: 'Printer', stepOid: 's1', amount: 1, heldName: null },
  ]);

  await close();
});

const ENV_PRINTER_WITH_CHILD_SPEC = {
  local_id: 'wf', oid: 'wf-env-printer-parent', version: '1.0.0', last_modified_date: '2026-01-01',
  // Declared at the ROOT — collectEnvironmentScope walks the whole tree, so this environment is
  // reachable (and lockable, and routable) from a CHILD's own command too.
  environment_specifications: [ENV_PRINTER],
  steps: [
    step('p1'),
    { local_id: 'ChildRef', oid: 'proxy', step_type: 'WORKFLOW PROXY', version: '1.0.0', last_modified_date: '2026-01-01' },
  ],
  connections: [],
  children: [
    {
      local_id: 'ChildRef', oid: 'child-env-printer', version: '1.0.0', last_modified_date: '2026-01-01',
      parentChildSpecId: null, state: 'Effective',
      steps: [
        step('c1', {
          resource_command_specifications: [
            { command_type: 'Acquire', resource_name: 'Printer', resource_source_oid: 'env-printer' },
          ],
        }),
      ],
      connections: [],
    },
  ],
};

test('contextForNode\'s view shares the root\'s environment tier by reference, exactly like resources', async () => {
  const { db, close } = await makeTestDb();
  const wc = await makeWc(db);
  await db.insert(wcResource).values({
    workCenterId: wc.id, name: 'Printer', resourceType: 'binary exclusive use',
  });
  const wi = await makeInstance(db, wc, ENV_PRINTER_WITH_CHILD_SPEC, 'wf-env-printer-view', 1);

  const context = await openContext(
    db,
    { id: wi.id, workCenterId: wc.id, specJsonb: ENV_PRINTER_WITH_CHILD_SPEC, engineState: null, propertyStore: null },
    testDeps(),
  );

  const view = context.contextForNode('child-env-printer'); // a genuine child view, not the root itself
  expect(view).not.toBe(context);
  expect(view.envResources).toBe(context.envResources);
  expect(view.envSnapshot).toBe(context.envSnapshot);
  expect(view.envIndex).toBe(context.envIndex);
  expect(view.envKnownNames).toBe(context.envKnownNames);
  expect(view.envScope).toBe(context.envScope);

  await close();
});
