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
// Repeating SCRIPT (spec 2026-10-13 §6.2-§6.5) through the real loop with a fake clock — the
// gate-timed.test.ts harness, copied (same not-imported convention as the gate suites). Every
// pump re-opens the instance from the database, so state surviving between pumps is also the
// restart proof.
import { expect, test } from 'vitest';
import { eq, asc } from 'drizzle-orm';
import { workCenter, workflow, workflowInstance, stepInstance, traceEntry } from 'mission-control-db/src/db/schema/index';
import { requestPause, requestResume, requestStop, requestAbort } from 'mission-control-db/src/dao/runtime-control';
import { makeTestDb } from './helpers/db.js';
import { pumpUntilQuiet, testDeps } from './helpers/pump.js';
import { OPERATOR_CHANGE_CHANNEL } from '../src/core/reconcile.js';

const step = (oid: string, step_type: string, extra: Record<string, unknown> = {}) => ({
  local_id: oid, oid, step_type, version: '1.0.0', last_modified_date: '2026-01-01', ...extra,
});

async function seedQueued(db: any, spec: any): Promise<{ id: string }> {
  const [wc] = await db.insert(workCenter).values({ name: `wc-${Math.random()}`, path: `p${Math.random()}` }).returning();
  const [wf] = await db.insert(workflow).values({ workCenterId: wc.id, oid: spec.oid, name: spec.oid, version: '1.0.0', state: 'Approved', specJsonb: spec }).returning();
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'queued', queuedAt: new Date(),
    specJsonb: spec, startingParams: null, runtimeNumber: 1, runtimeLabel: 'RW-1',
    masterName: spec.oid, masterOid: spec.oid, masterVersion: '1.0.0', masterState: 'Approved',
  }).returning();
  return { id: wi.id };
}
async function traceOf(db: any, id: string): Promise<Array<[string, string | null]>> {
  const rows = await db.select().from(traceEntry).where(eq(traceEntry.workflowInstanceId, id)).orderBy(asc(traceEntry.orderIndex));
  return rows.filter((r: any) => r.stepOid === 'sc').map((r: any) => [r.state, r.error]);
}
async function scriptRow(db: any, id: string): Promise<any> {
  return (await db.select().from(stepInstance).where(eq(stepInstance.workflowInstanceId, id))).find((r: any) => r.stepOid === 'sc');
}
async function instanceRow(db: any, id: string): Promise<any> {
  return (await db.select().from(workflowInstance).where(eq(workflowInstance.id, id)))[0];
}
function makeClock(start = new Date('2026-01-01T00:00:00.000Z')) {
  let now = start;
  return { now: () => now, advance: (secs: number) => { now = new Date(now.getTime() + secs * 1000); } };
}
const at = (t0: Date, s: number) => new Date(t0.getTime() + s * 1000).getTime();

/** START -> SCRIPT(repeat) -> END; reads Tank.Level as `level`, writes `runs` to Result.Runs. */
function repeatSpec(oid: string, source: string, repeat: Record<string, unknown>) {
  return {
    local_id: 'wf', oid, version: '1.0.0', last_modified_date: '2026-01-01', schemaVersion: '5.0',
    value_property_specifications: [
      { name: 'Tank', entries: [{ name: 'Level', value: '10' }] },
      { name: 'Result', entries: [{ name: 'Runs', value: 'none' }] },
    ],
    steps: [
      step('s', 'START'),
      step('sc', 'SCRIPT', {
        script_config: { source, repeat },
        input_parameter_specifications: [{ id: 'level', default_value: 'Tank.Level', value_type: 'property' }],
        output_parameter_specifications: [{ id: 'runs', target: 'Result.Runs' }],
      }),
      step('e', 'END'),
    ],
    connections: [{ from_step_id: 's', to_step_id: 'sc' }, { from_step_id: 'sc', to_step_id: 'e' }],
  };
}
const COUNT_UNTIL_FULL = 'state.n = (state.n || 0) + 1; output.runs = state.n; return Number(level) >= 90;';
const COUNT_FOREVER = 'state.n = (state.n || 0) + 1; output.runs = state.n; return false;';

test('runs each cycle with its state, keeps outputs pending, re-reads inputs, and completes on true', async () => {
  const { db, close } = await makeTestDb();
  const clock = makeClock();
  const t0 = clock.now();
  const deps = testDeps({ now: clock.now });
  const wi = await seedQueued(db, repeatSpec('wf-rs-1', COUNT_UNTIL_FULL, { cycle_seconds: 5 }));
  await pumpUntilQuiet(db, deps);

  let row = await scriptRow(db, wi.id);
  expect(row.state).toBe('WAITING_SCRIPT');
  expect(new Date(row.startedAt).getTime()).toBe(t0.getTime());
  expect(new Date(row.wakeAt).getTime()).toBe(at(t0, 5));
  let inst = await instanceRow(db, wi.id);
  expect(inst.engineState.scriptRuns.sc).toEqual({ state: { n: 1 }, pendingOutputs: { runs: '1' } });
  expect(inst.propertyStore?.['Result.Runs']).not.toBe('1'); // pending, not committed

  clock.advance(4);
  await pumpUntilQuiet(db, deps);
  expect((await instanceRow(db, wi.id)).engineState.scriptRuns.sc.state).toEqual({ n: 1 }); // not due yet

  clock.advance(1);
  await pumpUntilQuiet(db, deps);
  row = await scriptRow(db, wi.id);
  expect(row.state).toBe('WAITING_SCRIPT'); // the action claim never takes a WAITING_SCRIPT row
  expect(new Date(row.wakeAt).getTime()).toBe(at(t0, 10));
  inst = await instanceRow(db, wi.id);
  expect(inst.engineState.scriptRuns.sc).toEqual({ state: { n: 2 }, pendingOutputs: { runs: '2' } });

  await db.update(workflowInstance).set({ propertyStore: { ...inst.propertyStore, 'Tank.Level': '95' } }).where(eq(workflowInstance.id, wi.id));
  clock.advance(5);
  await pumpUntilQuiet(db, deps);
  inst = await instanceRow(db, wi.id);
  expect(inst.status).toBe('completed');
  expect(inst.propertyStore['Result.Runs']).toBe('3');
  expect(inst.engineState.scriptRuns.sc).toBeUndefined();
  expect(await traceOf(db, wi.id)).toEqual([['EXECUTING', null], ['COMPLETED', null]]);
  await close();
});

test('a script that is done on its first run completes exactly like a one-shot script', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  const wi = await seedQueued(db, repeatSpec('wf-rs-2', 'output.runs = "first"; return true;', {}));
  await pumpUntilQuiet(db, deps);
  const inst = await instanceRow(db, wi.id);
  expect(inst.status).toBe('completed');
  expect(inst.propertyStore['Result.Runs']).toBe('first');
  expect(await traceOf(db, wi.id)).toEqual([['COMPLETED', null]]);
  await close();
});

test("time limit 'error': the wake never passes the limit, then the step fails at it", async () => {
  const { db, close } = await makeTestDb();
  const clock = makeClock();
  const t0 = clock.now();
  const deps = testDeps({ now: clock.now });
  const wi = await seedQueued(db, repeatSpec('wf-rs-3', COUNT_FOREVER, { cycle_seconds: 5, time_limit_seconds: 12 }));
  await pumpUntilQuiet(db, deps);
  clock.advance(5); await pumpUntilQuiet(db, deps);
  clock.advance(5); await pumpUntilQuiet(db, deps);
  expect(new Date((await scriptRow(db, wi.id)).wakeAt).getTime()).toBe(at(t0, 12));
  clock.advance(2); await pumpUntilQuiet(db, deps);
  const row = await scriptRow(db, wi.id);
  expect(row.state).toBe('ERRORED');
  expect(row.error).toBe('Script time limit (12 s) reached');
  const inst = await instanceRow(db, wi.id);
  expect(inst.status).toBe('errored');
  expect(inst.engineState.scriptRuns.sc).toBeUndefined();
  await close();
});

test("time limit 'complete': commits the last run's outputs without running again", async () => {
  const { db, close } = await makeTestDb();
  const clock = makeClock();
  const deps = testDeps({ now: clock.now });
  const wi = await seedQueued(db, repeatSpec('wf-rs-4', COUNT_FOREVER, { cycle_seconds: 5, time_limit_seconds: 7, on_time_limit: 'complete' }));
  await pumpUntilQuiet(db, deps);
  clock.advance(5); await pumpUntilQuiet(db, deps); // run 2
  clock.advance(2); await pumpUntilQuiet(db, deps); // limit
  const inst = await instanceRow(db, wi.id);
  expect(inst.status).toBe('completed');
  expect(inst.propertyStore['Result.Runs']).toBe('2');
  expect(await traceOf(db, wi.id)).toEqual([
    ['EXECUTING', null],
    ['WARNING', 'Script time limit (7 s) reached — completed with its current outputs'],
    ['COMPLETED', null],
  ]);
  await close();
});

test('pause past the time limit: on resume the limit applies at once and the script does not run again', async () => {
  const { db, close } = await makeTestDb();
  const clock = makeClock();
  const deps = testDeps({ now: clock.now });
  const wi = await seedQueued(db, repeatSpec('wf-rs-5', COUNT_FOREVER, { cycle_seconds: 5, time_limit_seconds: 7, on_time_limit: 'complete' }));
  await pumpUntilQuiet(db, deps);
  await requestPause(db, wi.id);
  await pumpUntilQuiet(db, deps);
  expect((await instanceRow(db, wi.id)).status).toBe('paused');
  clock.advance(60);
  await pumpUntilQuiet(db, deps);
  expect((await scriptRow(db, wi.id)).state).toBe('WAITING_SCRIPT'); // a paused instance never runs it
  await requestResume(db, wi.id);
  await pumpUntilQuiet(db, deps);
  const inst = await instanceRow(db, wi.id);
  expect(inst.status).toBe('completed');
  expect(inst.propertyStore['Result.Runs']).toBe('1');
  await close();
});

test('a throw on a later run fails the step and drops its saved state', async () => {
  const { db, close } = await makeTestDb();
  const clock = makeClock();
  const deps = testDeps({ now: clock.now });
  const wi = await seedQueued(db, repeatSpec('wf-rs-6',
    'state.n = (state.n || 0) + 1; if (state.n === 2) throw new Error("sensor offline"); return false;', { cycle_seconds: 5 }));
  await pumpUntilQuiet(db, deps);
  clock.advance(5); await pumpUntilQuiet(db, deps);
  const row = await scriptRow(db, wi.id);
  expect(row.state).toBe('ERRORED');
  expect(row.error).toContain('sensor offline');
  expect((await instanceRow(db, wi.id)).engineState.scriptRuns.sc).toBeUndefined();
  await close();
});

test('oversized or non-JSON state fails the step on the run that produced it', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  const big = await seedQueued(db, repeatSpec('wf-rs-7', 'state.blob = "x".repeat(70000); return false;', {}));
  const bad = await seedQueued(db, repeatSpec('wf-rs-8', 'state.big = 10n; return false;', {}));
  await pumpUntilQuiet(db, deps);
  expect((await scriptRow(db, big.id)).error).toBe('Script state exceeds 64 KB');
  expect((await scriptRow(db, bad.id)).error).toBe('Script state is not JSON');
  await close();
});

test('stop cancels a waiting script; abort flips it ABORTED', async () => {
  const { db, close } = await makeTestDb();
  const deps = testDeps();
  const a = await seedQueued(db, repeatSpec('wf-rs-9', COUNT_FOREVER, {}));
  const b = await seedQueued(db, repeatSpec('wf-rs-10', COUNT_FOREVER, {}));
  await pumpUntilQuiet(db, deps);
  await requestStop(db, a.id);
  await requestAbort(db, b.id);
  await pumpUntilQuiet(db, deps);
  const stopped = await scriptRow(db, a.id);
  expect(stopped.state).toBe('CANCELLED');
  expect(stopped.wakeAt).toBeNull();
  expect((await instanceRow(db, a.id)).status).toBe('stopped');
  expect((await scriptRow(db, b.id)).state).toBe('ABORTED');
  expect((await instanceRow(db, b.id)).status).toBe('aborted');
  await close();
});

test('a due run that completes (or fails) the script sends the work-center NOTIFY', async () => {
  const { db, client, close } = await makeTestDb();
  const clock = makeClock();
  const deps = testDeps({ now: clock.now });
  const done = await seedQueued(db, repeatSpec('wf-rs-notify-1', 'output.runs = "x"; return state.n === 1 ? true : (state.n = 1, false);', { cycle_seconds: 5 }));
  const bad = await seedQueued(db, repeatSpec('wf-rs-notify-2', 'if (state.n) throw new Error("boom"); state.n = 1; return false;', { cycle_seconds: 5 }));
  await pumpUntilQuiet(db, deps);
  expect((await scriptRow(db, done.id)).state).toBe('WAITING_SCRIPT');
  expect((await scriptRow(db, bad.id)).state).toBe('WAITING_SCRIPT');
  const received: string[] = [];
  await client.listen(OPERATOR_CHANGE_CHANNEL, (payload: string) => { received.push(payload); });
  const wcOf = async (id: string) => (await instanceRow(db, id)).workCenterId;
  clock.advance(5);
  await pumpUntilQuiet(db, deps);
  expect((await instanceRow(db, done.id)).status).toBe('completed');
  expect((await scriptRow(db, bad.id)).state).toBe('ERRORED');
  await new Promise((r) => setTimeout(r, 50));
  expect(received).toContain(await wcOf(done.id));
  expect(received).toContain(await wcOf(bad.id));
  await close();
});

/** START -> SCRIPT(repeat, TRY ERROR -> C1) -> END; CATCH C1 -> RETURN <returnConfig>. */
function trySpec(oid: string, returnConfig: Record<string, unknown>) {
  const spec = repeatSpec(oid, COUNT_FOREVER, { cycle_seconds: 5, time_limit_seconds: 7 });
  (spec.steps[1] as any).try_specifications = [{ mode: 'ERROR', catch_id: 'C1' }];
  spec.steps.push(step('c1', 'CATCH', { catch_id: 'C1' }) as any, step('r1', 'RETURN', { return_config: returnConfig }) as any);
  (spec.connections as any[]).push({ from_step_id: 'c1', to_step_id: 'r1' });
  return spec;
}
async function allTrace(db: any, id: string): Promise<Array<[string | null, string]>> {
  const rows = await db.select().from(traceEntry).where(eq(traceEntry.workflowInstanceId, id)).orderBy(asc(traceEntry.orderIndex));
  return rows.map((r: any) => [r.stepOid, r.state]);
}

test("time limit 'error' under a TRY routes to the CATCH; the instance does not error", async () => {
  const { db, close } = await makeTestDb();
  const clock = makeClock();
  const deps = testDeps({ now: clock.now });
  const wi = await seedQueued(db, trySpec('wf-rs-try-1', { command: 'COMPLETE' }));
  await pumpUntilQuiet(db, deps);
  clock.advance(5); await pumpUntilQuiet(db, deps);
  clock.advance(2); await pumpUntilQuiet(db, deps); // the limit
  const inst = await instanceRow(db, wi.id);
  expect(inst.status).toBe('completed');
  const trace = await allTrace(db, wi.id);
  expect(trace.some(([oid]) => oid === 'c1')).toBe(true); // the CATCH network ran
  expect(trace).not.toContainEqual(['sc', 'ERRORED']);
  expect(inst.engineState.scriptRuns.sc).toBeUndefined();
  await close();
});

test('a repeating script re-entered (CATCH -> RETURN GOTO) starts its new activation with fresh state', async () => {
  const { db, close } = await makeTestDb();
  const clock = makeClock();
  const deps = testDeps({ now: clock.now });
  const wi = await seedQueued(db, trySpec('wf-rs-try-2', { command: 'GOTO', goto_step_oid: 'sc' }));
  await pumpUntilQuiet(db, deps);
  clock.advance(5); await pumpUntilQuiet(db, deps);
  expect((await instanceRow(db, wi.id)).engineState.scriptRuns.sc.state).toEqual({ n: 2 });
  clock.advance(2); await pumpUntilQuiet(db, deps); // the limit -> CATCH -> GOTO sc
  const row = await scriptRow(db, wi.id);
  expect(row.state).toBe('WAITING_SCRIPT');
  expect(new Date(row.startedAt).getTime()).toBe(clock.now().getTime());
  const inst = await instanceRow(db, wi.id);
  expect(inst.status).toBe('running');
  expect(inst.engineState.scriptRuns.sc).toEqual({ state: { n: 1 }, pendingOutputs: { runs: '1' } });
  await close();
});

// ── A repeating SCRIPT inside a WORKFLOW PROXY child: it reads and writes the CHILD's own
// property store (engineState.childProperties[childOid]), parks under the child's node oid, keeps
// its state in the shared scriptRuns map, and its pending outputs land in the child's store. ──

const CHILD_REPEAT_SPEC = {
  local_id: 'wf', oid: 'wf-child-rs', version: '1.0.0', last_modified_date: '2026-01-01', schemaVersion: '5.0',
  steps: [step('ps', 'START'), step('proxy', 'WORKFLOW PROXY'), step('pe', 'END')],
  connections: [{ from_step_id: 'ps', to_step_id: 'proxy' }, { from_step_id: 'proxy', to_step_id: 'pe' }],
  children: [{
    local_id: 'proxy', oid: 'child-rs', version: '1.0.0', last_modified_date: '2026-01-01',
    parentChildSpecId: null, state: 'Effective',
    value_property_specifications: [
      { name: 'Tank', entries: [{ name: 'Level', value: '10' }] },
      { name: 'Result', entries: [{ name: 'Runs', value: 'none' }] },
    ],
    steps: [
      step('cs', 'START'),
      step('sc', 'SCRIPT', {
        script_config: { source: COUNT_UNTIL_FULL, repeat: { cycle_seconds: 5 } },
        input_parameter_specifications: [{ id: 'level', default_value: 'Tank.Level', value_type: 'property' }],
        output_parameter_specifications: [{ id: 'runs', target: 'Result.Runs' }],
      }),
      step('ce', 'END'),
    ],
    connections: [{ from_step_id: 'cs', to_step_id: 'sc' }, { from_step_id: 'sc', to_step_id: 'ce' }],
  }],
};

test('a repeating script inside a WORKFLOW PROXY child runs on the child store, blocks the proxy, and completes the child', async () => {
  const { db, close } = await makeTestDb();
  const clock = makeClock();
  const t0 = clock.now();
  const deps = testDeps({ now: clock.now });
  const wi = await seedQueued(db, CHILD_REPEAT_SPEC);
  await pumpUntilQuiet(db, deps);

  let row = await scriptRow(db, wi.id);
  expect(row.state).toBe('WAITING_SCRIPT');
  expect(row.nodeOid).toBe('child-rs');
  expect(new Date(row.wakeAt).getTime()).toBe(at(t0, 5));
  const proxy = (await db.select().from(stepInstance).where(eq(stepInstance.workflowInstanceId, wi.id))).find((r: any) => r.stepOid === 'proxy');
  expect(proxy?.state).toBe('WAITING_ACTION');
  let inst = await instanceRow(db, wi.id);
  expect(inst.status).toBe('running');
  expect(inst.engineState.scriptRuns.sc).toEqual({ state: { n: 1 }, pendingOutputs: { runs: '1' } });
  expect(inst.engineState.childProperties['child-rs']['Result.Runs']).toBe('none'); // pending, not committed

  clock.advance(5);
  await pumpUntilQuiet(db, deps);
  inst = await instanceRow(db, wi.id);
  expect(inst.engineState.scriptRuns.sc).toEqual({ state: { n: 2 }, pendingOutputs: { runs: '2' } });

  // Fill the CHILD's tank (its own property home, not the root's property_store).
  const childProperties = { ...inst.engineState.childProperties, 'child-rs': { ...inst.engineState.childProperties['child-rs'], 'Tank.Level': '95' } };
  await db.update(workflowInstance).set({ engineState: { ...inst.engineState, childProperties } }).where(eq(workflowInstance.id, wi.id));
  clock.advance(5);
  await pumpUntilQuiet(db, deps);

  inst = await instanceRow(db, wi.id);
  row = await scriptRow(db, wi.id);
  expect(row.state).toBe('COMPLETED');
  expect(inst.status).toBe('completed');
  expect(inst.engineState.scriptRuns.sc).toBeUndefined();
  expect(inst.propertyStore?.['Result.Runs']).toBeUndefined(); // the root store never saw the child's output
  await close();
});
