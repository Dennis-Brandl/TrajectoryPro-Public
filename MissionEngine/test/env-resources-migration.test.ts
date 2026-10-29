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
// Task 6 (Phase 2a, spec §5.7): the running-instance fold-out. An instance already running when
// this phase deploys carries its environment resources inside its OWN per-instance
// engine_state.resources (the shape `registerResource` produced before this phase existed),
// keyed `${envOid}:${name}`. Its first hydrate through openContext must fold those into the
// SHARED registry tier exactly once — PURELY IN-MEMORY. `openContext` writes nothing itself for
// this fold; Task 5's `persist()` carries both halves of the amendment atomically (the registry
// counters via diffRegistry, and the dropped legacy entries via context.resources' own toJSON())
// on whichever call site actually persists this hydration — see the controller's reversed ruling
// recorded in the program ledger for why a direct write inside the fold would be unsafe.
//
// The user drains the work centers before this deploys (spec §10 step 0), so this path is
// expected to be dead in practice; it is built and tested anyway for any instance that slips
// through.
import { expect, test, vi } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { makeTestDb } from './helpers/db.js';
import { testDeps } from './helpers/pump.js';
import { openContext, foldOutLegacyEnvResources } from '../src/core/context.js';
import * as wcResources from 'mission-control-db/src/runtime/wc-resources';
import {
  workCenter, workflow, workflowInstance, wcResource, wcResourceWaiter, wcResourceHolder,
} from 'mission-control-db/src/db/schema/index';
import type { EngineState } from '../src/core/engine-state.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

const step = (oid: string, step_type: string, extra: Record<string, unknown> = {}) => ({
  local_id: oid, oid, step_type, version: '1.0.0', last_modified_date: '2026-01-01', ...extra,
});

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

async function instanceRow(db: AnyDb, instanceId: string) {
  const [row] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, instanceId));
  return row;
}

async function resourceRow(db: AnyDb, workCenterId: string, name: string) {
  const [row] = await db.select().from(wcResource)
    .where(and(eq(wcResource.workCenterId, workCenterId), eq(wcResource.name, name)));
  return row;
}

async function holdersOf(db: AnyDb, instanceId: string) {
  return db.select().from(wcResourceHolder).where(eq(wcResourceHolder.instanceId, instanceId));
}

async function waitersOf(db: AnyDb, workCenterId: string, name: string) {
  return db.select().from(wcResourceWaiter)
    .where(and(eq(wcResourceWaiter.workCenterId, workCenterId), eq(wcResourceWaiter.name, name)));
}

// ── fixtures ──────────────────────────────────────────────────────────────────────────────────

const ENV_PRINTER = {
  local_id: 'env-printer-lib', oid: 'env-printer', version: '1.0.0', last_modified_date: '2026-01-01',
  resource_property_specifications: [{ name: 'Printer', resource_type: 'binary exclusive use' }],
};

const ENV_BAY = {
  local_id: 'env-bay-lib', oid: 'env-bay', version: '1.0.0', last_modified_date: '2026-01-01',
  resource_property_specifications: [{ name: 'Bay', resource_type: 'named pool', names: ['A', 'B', 'C'] }],
};

function acquireSpec(oid: string, env: unknown, envOid: string, name: string) {
  return {
    local_id: 'wf', oid, version: '1.0.0', last_modified_date: '2026-01-01',
    environment_specifications: [env],
    steps: [
      step('s1', 'START'),
      step('s2', 'MATH', {
        resource_command_specifications: [
          { command_type: 'Acquire', resource_name: name, resource_source_oid: envOid },
        ],
      }),
      step('e1', 'END'),
    ],
    connections: [
      { from_step_id: 's1', to_step_id: 's2' },
      { from_step_id: 's2', to_step_id: 'e1' },
    ],
  };
}

const ENV_PRINTER_SPEC = acquireSpec('wf-legacy-printer', ENV_PRINTER, 'env-printer', 'Printer');
const ENV_BAY_SPEC = acquireSpec('wf-legacy-bay', ENV_BAY, 'env-bay', 'Bay');

// Declares no environment_specifications and no resource commands at all.
const NO_ENV_SPEC = {
  local_id: 'wf', oid: 'wf-legacy-no-env', version: '1.0.0', last_modified_date: '2026-01-01',
  steps: [step('s1', 'START'), step('e1', 'END')],
  connections: [{ from_step_id: 's1', to_step_id: 'e1' }],
};

// The pre-Phase-2a shape: everything (workflow- and environment-scoped alike) lived in ONE
// per-instance manager, keyed `${resource_source_oid}:${name}`.
function legacyResources(entries: [string, Record<string, unknown>][]) {
  return { resources: entries, pendingGrants: [], syncMatchedData: [], pendingNamedAssignments: [] };
}

const legacyBinaryHold = (key: string, ownerId: string, inUse: 0 | 1, queue: string[] = []): [string, Record<string, unknown>] =>
  [key, { type: 'binary exclusive use', inUse, queue, ownerId, scope: 'environment', resourceKey: key }];

const legacyNamedPoolHold = (
  key: string, ownerId: string, originalNames: string[], available: string[], queue: string[] = [],
): [string, Record<string, unknown>] =>
  [key, { type: 'named pool', available, originalNames, queue, ownerId, scope: 'environment', resourceKey: key }];

const legacyWorkflowHold = (key: string, ownerId: string, inUse: 0 | 1): [string, Record<string, unknown>] =>
  [key, { type: 'binary exclusive use', inUse, queue: [], ownerId, scope: 'workflow', resourceKey: key }];

// ── tests ─────────────────────────────────────────────────────────────────────────────────────

test('brief cases 1+2: a legacy binary-exclusive hold folds its counter into the registry and becomes an UNTRACKED in-use unit (no holder row)', async () => {
  const { db, close } = await makeTestDb();
  const wc = await makeWc(db);
  await db.insert(wcResource).values({ workCenterId: wc.id, name: 'Printer', resourceType: 'binary exclusive use', inUse: 0 });
  const wi = await makeInstance(db, wc, ENV_PRINTER_SPEC, 'wf-legacy-printer');

  const engineState = { resources: legacyResources([legacyBinaryHold('env-printer:Printer', 'env-printer', 1)]) };

  const context = await openContext(
    db, { id: wi.id, workCenterId: wc.id, specJsonb: ENV_PRINTER_SPEC, engineState, propertyStore: null }, testDeps(),
  );

  // In-memory, immediately: the legacy entry is gone from the local manager...
  expect(context.resources!.toJSON().resources.some(([, s]) => s.scope === 'environment')).toBe(false);
  // ...and its counter folded into the JUST-HYDRATED shared tier.
  const [printer] = context.envResources!.getSnapshot().filter((s) => s.name === 'Printer');
  expect(printer).toMatchObject({ inUse: 1 });
  // Untracked: the fold never appends to state.envHolds — there is no per-holder record for it.
  expect(context.state.envHolds).toEqual([]);

  // Important 2 (review fix): the fold is PURELY IN-MEMORY — it must write NOTHING before
  // persist() runs. An implementation that wrote the registry directly inside the fold (the
  // unsafe design this task's corrections explicitly reversed) would pass every OTHER assertion
  // in this file unchanged, because persist()'s own counter echo is idempotent with respect to
  // the same value it already wrote. This is the one assertion that would actually catch it:
  // taken BEFORE persist() ever runs, the real DB row must still show the PRE-fold state.
  expect((await resourceRow(db, wc.id, 'Printer')).inUse).toBe(0);
  expect(await waitersOf(db, wc.id, 'Printer')).toEqual([]);

  await context.persist(db);

  // engine_state.resources on the real row no longer carries the legacy entry either.
  const after = await instanceRow(db, wi.id);
  const resources = (after.engineState as EngineState).resources!.resources;
  expect(resources.some(([, s]) => s.scope === 'environment')).toBe(false);

  // The registry's own in_use reflects the fold-in (brief case 1)...
  expect((await resourceRow(db, wc.id, 'Printer')).inUse).toBe(1);
  // ...but UNTRACKED — no holder row was ever created, because that information never existed
  // on this side either (brief case 2).
  expect(await holdersOf(db, wi.id)).toEqual([]);

  await close();
});

test('brief case 3: a legacy named-pool hold moves its held names out of available_names in the registry', async () => {
  const { db, close } = await makeTestDb();
  const wc = await makeWc(db);
  await db.insert(wcResource).values({
    workCenterId: wc.id, name: 'Bay', resourceType: 'named pool',
    poolNames: ['A', 'B', 'C'], availableNames: ['A', 'B', 'C'], inUse: 0,
  });
  const wi = await makeInstance(db, wc, ENV_BAY_SPEC, 'wf-legacy-bay');

  // This instance's legacy local copy holds 'B' — 'B' is absent from ITS OWN available list.
  const engineState = {
    resources: legacyResources([legacyNamedPoolHold('env-bay:Bay', 'env-bay', ['A', 'B', 'C'], ['A', 'C'])]),
  };

  const context = await openContext(
    db, { id: wi.id, workCenterId: wc.id, specJsonb: ENV_BAY_SPEC, engineState, propertyStore: null }, testDeps(),
  );
  await context.persist(db);

  const bay = await resourceRow(db, wc.id, 'Bay');
  expect([...bay.availableNames].sort()).toEqual(['A', 'C']);
  expect(bay.inUse).toBe(1);
  expect(await holdersOf(db, wi.id)).toEqual([]); // untracked, same as the binary case above

  await close();
});

test("brief case 4: a legacy queue entry folds into a waiter row carrying THIS instance's id", async () => {
  const { db, close } = await makeTestDb();
  const wc = await makeWc(db);
  await db.insert(wcResource).values({ workCenterId: wc.id, name: 'Printer', resourceType: 'binary exclusive use', inUse: 0 });
  const wi = await makeInstance(db, wc, ENV_PRINTER_SPEC, 'wf-legacy-printer-q');

  // Legacy: this instance itself holds Printer (inUse: 1), and its own sibling branch ('s2b')
  // is queued behind it — the only way a queue entry could ever exist in a PRE-2a,
  // per-instance-only manager (there was no cross-instance sharing for it to queue against).
  const engineState = {
    resources: legacyResources([legacyBinaryHold('env-printer:Printer', 'env-printer', 1, ['s2b'])]),
  };

  const context = await openContext(
    db, { id: wi.id, workCenterId: wc.id, specJsonb: ENV_PRINTER_SPEC, engineState, propertyStore: null }, testDeps(),
  );
  await context.persist(db);

  const waiters = await waitersOf(db, wc.id, 'Printer');
  expect(waiters).toHaveLength(1);
  expect(waiters[0]).toMatchObject({ instanceId: wi.id, stepOid: 's2b', kind: 'acquire', granted: false });

  await close();
});

test('brief case 5: folding is idempotent — a genuine second openContext does not double-count', async () => {
  const { db, close } = await makeTestDb();
  const wc = await makeWc(db);
  await db.insert(wcResource).values({ workCenterId: wc.id, name: 'Printer', resourceType: 'binary exclusive use', inUse: 0 });
  const wi = await makeInstance(db, wc, ENV_PRINTER_SPEC, 'wf-legacy-printer-idem');

  const engineState = { resources: legacyResources([legacyBinaryHold('env-printer:Printer', 'env-printer', 1)]) };

  const first = await openContext(
    db, { id: wi.id, workCenterId: wc.id, specJsonb: ENV_PRINTER_SPEC, engineState, propertyStore: null }, testDeps(),
  );
  // Its own return-value contract: nothing is left to fold against the SAME already-folded
  // context, and it says so honestly.
  expect(foldOutLegacyEnvResources(first, first.envSnapshot!)).toBe(false);
  await first.persist(db);
  expect((await resourceRow(db, wc.id, 'Printer')).inUse).toBe(1);

  // Genuine re-open: a FRESH WorkflowContext, built from the row exactly as persist() left it —
  // not merely re-asserting on the same, already-mutated context object.
  const row = await instanceRow(db, wi.id);
  const second = await openContext(
    db,
    { id: wi.id, workCenterId: wc.id, specJsonb: ENV_PRINTER_SPEC, engineState: row.engineState, propertyStore: row.propertyStore },
    testDeps(),
  );
  // Nothing left in the local manager to fold — the legacy entry is genuinely gone, not merely
  // untouched.
  expect(second.resources!.toJSON().resources).toEqual([]);
  await second.persist(db);

  expect((await resourceRow(db, wc.id, 'Printer')).inUse).toBe(1); // unchanged — not 2
  expect(await holdersOf(db, wi.id)).toEqual([]);

  await close();
});

test('brief case 6: an instance with only workflow-scoped legacy resources is untouched, and hydration never runs', async () => {
  const { db, close } = await makeTestDb();
  const wc = await makeWc(db);
  const wi = await makeInstance(db, wc, NO_ENV_SPEC, 'wf-legacy-workflow-only');

  const engineState = {
    resources: legacyResources([legacyWorkflowHold('wf-legacy-no-env:Local', 'wf-legacy-no-env', 1)]),
  };

  const lockSpy = vi.spyOn(wcResources, 'lockRegistry');
  const context = await openContext(
    db, { id: wi.id, workCenterId: wc.id, specJsonb: NO_ENV_SPEC, engineState, propertyStore: null }, testDeps(),
  );

  expect(context.envResources).toBeNull();
  expect(lockSpy).not.toHaveBeenCalled(); // no environment resources anywhere -> hydration never ran
  // Untouched: the SAME single workflow-scoped entry survives, unchanged.
  expect(context.resources!.toJSON().resources).toEqual([
    ['wf-legacy-no-env:Local', {
      type: 'binary exclusive use', inUse: 1, queue: [], ownerId: 'wf-legacy-no-env',
      scope: 'workflow', resourceKey: 'wf-legacy-no-env:Local',
    }],
  ]);

  lockSpy.mockRestore();
  await close();
});

test('a legacy hold for a resource the CURRENT recipe no longer references is unioned into the ONE lockRegistry call, not a second lock', async () => {
  const { db, close } = await makeTestDb();
  const wc = await makeWc(db);
  await db.insert(wcResource).values({ workCenterId: wc.id, name: 'Printer', resourceType: 'binary exclusive use', inUse: 0 });
  await db.insert(wcResource).values({
    workCenterId: wc.id, name: 'Bay', resourceType: 'named pool', poolNames: ['A', 'B'], availableNames: ['A', 'B'], inUse: 0,
  });
  const wi = await makeInstance(db, wc, ENV_PRINTER_SPEC, 'wf-legacy-printer-orphan');

  // The CURRENT recipe (ENV_PRINTER_SPEC) only references 'Printer' — 'Bay' is an ORPHANED
  // legacy hold (the recipe changed since this instance started, or it never named 'Bay').
  const engineState = {
    resources: legacyResources([legacyNamedPoolHold('env-bay:Bay', 'env-bay', ['A', 'B'], ['A'])]),
  };

  const lockSpy = vi.spyOn(wcResources, 'lockRegistry');
  const context = await openContext(
    db, { id: wi.id, workCenterId: wc.id, specJsonb: ENV_PRINTER_SPEC, engineState, propertyStore: null }, testDeps(),
  );

  expect(lockSpy).toHaveBeenCalledTimes(1); // ONE call — never a second lock for the orphaned name
  // Asserts on just the names argument (not the full call, which would include `db` itself) —
  // a mismatch here must never force a pretty-printed diff of the whole drizzle/PGlite handle.
  expect(lockSpy.mock.calls[0]?.[2]).toEqual(['Bay', 'Printer']); // unioned, name-ascending
  lockSpy.mockRestore();

  await context.persist(db);
  expect([...(await resourceRow(db, wc.id, 'Bay')).availableNames].sort()).toEqual(['A']); // 'B' folded out
  expect((await resourceRow(db, wc.id, 'Printer')).inUse).toBe(0); // untouched — no legacy hold names it

  await close();
});

test('the fold runs even when the recipe itself names zero environment resources, as long as a legacy entry exists', async () => {
  const { db, close } = await makeTestDb();
  const wc = await makeWc(db);
  await db.insert(wcResource).values({ workCenterId: wc.id, name: 'Printer', resourceType: 'binary exclusive use', inUse: 0 });
  const wi = await makeInstance(db, wc, NO_ENV_SPEC, 'wf-legacy-no-env-with-hold');

  const engineState = { resources: legacyResources([legacyBinaryHold('env-printer:Printer', 'env-printer', 1)]) };

  const lockSpy = vi.spyOn(wcResources, 'lockRegistry');
  const context = await openContext(
    db, { id: wi.id, workCenterId: wc.id, specJsonb: NO_ENV_SPEC, engineState, propertyStore: null }, testDeps(),
  );
  // envResourceNames(NO_ENV_SPEC) is [] on its own — the legacy name is the ENTIRE lock set.
  expect(lockSpy).toHaveBeenCalledTimes(1);
  // Asserts on just the names argument, same reasoning as the sibling union test above.
  expect(lockSpy.mock.calls[0]?.[2]).toEqual(['Printer']);
  lockSpy.mockRestore();

  expect(context.envResources).not.toBeNull(); // hydration ran, even though the recipe names nothing
  await context.persist(db);
  expect((await resourceRow(db, wc.id, 'Printer')).inUse).toBe(1);

  await close();
});

// Important 1 (review fix): only the binary-exclusive branch's envToken usage was previously
// guarded end to end (brief case 4) — the countable branch, the named-pool QUEUE line (test 3
// and the union test both use pools with empty queues), and the sync branch were all untested.
// A wrong-but-plausible version of any of these is silent and irreversible: diffRegistry skips
// any token whose parsed owner is not this instance, so a branch pushing bare oids instead of
// envToken(context.id, stepOid) would produce NO waiter rows at all — while the fold had ALREADY
// deleted the legacy entry. Table-driven: one row per remaining branch, each folding a QUEUED
// entry and asserting the resulting waiter row(s) carry the right kind/amount/payload.
test('table-driven: a QUEUED entry of each remaining resource type folds into a waiter row with the right kind/amount/payload', async () => {
  const cases: {
    label: string;
    resourceName: string;
    seed: { resourceType: string; useLimit?: number; poolNames?: string[]; availableNames?: string[]; inUse?: number };
    legacyEntry: [string, Record<string, unknown>];
    expectedWaiters: { stepOid: string; kind: string; amount: number | null; payload: string | null }[];
  }[] = [
    {
      label: 'countable use with pool limits',
      resourceName: 'Widget',
      seed: { resourceType: 'countable use with pool limits', useLimit: 5, inUse: 0 },
      legacyEntry: ['env-widget:Widget', {
        type: 'countable use with pool limits', inUse: 0, useLimit: 5,
        queue: [{ stepOid: 'sC', amount: 3 }],
        ownerId: 'env-widget', scope: 'environment', resourceKey: 'env-widget:Widget',
      }],
      expectedWaiters: [{ stepOid: 'sC', kind: 'acquire', amount: 3, payload: null }],
    },
    {
      // The named-pool queue LINE specifically — test 3 (brief case 3) and the union test both
      // exercise this resource type with an EMPTY queue, so the queue-fold loop itself (as
      // opposed to the held-names loop just above it) was never actually reached.
      label: 'named pool (queue line)',
      resourceName: 'Locker',
      seed: { resourceType: 'named pool', poolNames: ['X', 'Y'], availableNames: ['X', 'Y'] },
      legacyEntry: legacyNamedPoolHold('env-locker:Locker', 'env-locker', ['X', 'Y'], ['X', 'Y'], ['sN']),
      expectedWaiters: [{ stepOid: 'sN', kind: 'acquire', amount: null, payload: null }],
    },
    {
      label: 'sync (send + receive + sync, all three kinds at once)',
      resourceName: 'Channel',
      seed: { resourceType: 'sync' },
      legacyEntry: ['env-channel:Channel', {
        type: 'sync',
        sendQueue: [{ stepOid: 'sS', data: 'payload-x' }],
        receiveQueue: ['sR'],
        pendingSync: ['sP'],
        ownerId: 'env-channel', scope: 'environment', resourceKey: 'env-channel:Channel',
      }],
      expectedWaiters: [
        { stepOid: 'sS', kind: 'send', amount: null, payload: 'payload-x' },
        { stepOid: 'sR', kind: 'receive', amount: null, payload: null },
        { stepOid: 'sP', kind: 'sync', amount: null, payload: null },
      ],
    },
  ];

  for (const c of cases) {
    const { db, close } = await makeTestDb();
    const wc = await makeWc(db);
    await db.insert(wcResource).values({ workCenterId: wc.id, name: c.resourceName, ...c.seed });
    // NO_ENV_SPEC (per the union-fix property proven above): the legacy entry alone drives
    // hydration — no need for a per-type recipe fixture.
    const wi = await makeInstance(db, wc, NO_ENV_SPEC, `wf-table-${c.resourceName.toLowerCase()}`);

    const engineState = { resources: legacyResources([c.legacyEntry]) };
    const context = await openContext(
      db, { id: wi.id, workCenterId: wc.id, specJsonb: NO_ENV_SPEC, engineState, propertyStore: null }, testDeps(),
    );
    await context.persist(db);

    const waiters = await waitersOf(db, wc.id, c.resourceName);
    expect(waiters, c.label).toHaveLength(c.expectedWaiters.length);
    for (const expected of c.expectedWaiters) {
      const match = waiters.find((w: { stepOid: string }) => w.stepOid === expected.stepOid);
      expect(match, `${c.label}: waiter for step "${expected.stepOid}"`).toMatchObject({
        instanceId: wi.id, stepOid: expected.stepOid, kind: expected.kind,
        amount: expected.amount, payload: expected.payload, granted: false,
      });
    }

    await close();
  }
});
