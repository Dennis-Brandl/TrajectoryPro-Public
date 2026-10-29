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
// Task 13: conformance harness — a port of the reference repo's runner.ts:95-193
// (runFixture/runValidationFixture/runExecutionFixture/compareTrace/compareProperties) against
// the DB-backed engine, rather than the reference's in-memory WorkflowEngine. Exit criterion
// (task-13-brief.md, ruled during Task 6): REFERENCE PARITY — the reference runner itself fails
// 4 of the 82 vendored fixtures at the vendored commit (see PROVENANCE.md's "Known reference
// failures"); those are routed to test.skip in test/conformance.test.ts and never graded here.
//
// Deliberately self-contained within src/ — does NOT import test/helpers/pump.ts (production
// code must not depend on the test tree); harnessDeps()/pumpUntilQuiet below are narrow local
// equivalents built directly on loadConfig/runOnce, the same primitives the test helper itself
// uses.
import { randomUUID } from 'node:crypto';
import { eq, asc } from 'drizzle-orm';
import { workCenter, workflow, workflowInstance, traceEntry } from 'mission-control-db/src/db/schema/index';
import type { Db } from '../db.js';
import type { EngineDeps } from '../config.js';
import { loadConfig } from '../config.js';
import { nullActionInvoker } from '../actions/invoker.js';
import { runOnce } from '../loop.js';
import { validate } from '../spec/validator.js';
import { submitUserAction } from '../core/submit.js';
import { assembleReferenceTrace, type RawTraceRow } from '../core/trace-assembly.js';
import type { MasterWorkflowSpecification, TestFixture, TraceEntry as SpecTraceEntry, UserAction } from '../spec/types.js';

export interface FixtureResult { pass: boolean; detail?: string }

// ── deps / pump (local equivalents of test/helpers/pump.ts — see header comment) ──

function harnessDeps(fixture: TestFixture): EngineDeps {
  return {
    // P7 flake fix: the production 5000ms budget, not the old 200ms override — 14 conformance
    // fixtures carry `script_config`, and the vm timeout is wall-clock (watchdog thread), so a
    // descheduled fork under full-suite contention could trip it on a trivial script. See
    // test/helpers/pump.ts's testDeps doc comment for the measurements.
    config: loadConfig({ DATABASE_URL: 'unused', SCRIPT_TIMEOUT_MS: '5000' } as unknown as NodeJS.ProcessEnv),
    invoker: nullActionInvoker,
    now: () => new Date(),
    harnessInitialProperties: fixture.setup?.initial_properties,
    harnessSetupResources: fixture.setup?.resources,
  };
}

/** Loop runOnce until it reports idle. Single-slot by construction — pumpUntilQuiet always is
 *  (test/helpers/pump.ts's own doc comment); a runaway guard matches that helper's `max`. */
async function pumpUntilQuiet(db: Db, deps: EngineDeps, max = 10_000): Promise<void> {
  let cycles = 0;
  while (cycles < max) {
    const didWork = await runOnce(db, deps);
    if (!didWork) return;
    cycles++;
  }
}

// ── validation-category fixtures: pure validate() compare, no DB (runner.ts:107-128) ──

function runValidationFixture(fixture: TestFixture): FixtureResult {
  const result = validate(fixture.workflow);

  if (fixture.expected.valid !== result.valid) {
    return {
      pass: false,
      detail: `Expected valid=${fixture.expected.valid}, got valid=${result.valid}` +
        (result.error_code ? ` (error: ${result.error_code})` : ''),
    };
  }
  if (!fixture.expected.valid && fixture.expected.error_code && result.error_code !== fixture.expected.error_code) {
    return { pass: false, detail: `Expected error_code="${fixture.expected.error_code}", got "${result.error_code}"` };
  }
  return { pass: true };
}

// ── execution-category fixtures (runner.ts:130-193) ──

async function seedQueuedInstance(db: Db, fixture: TestFixture): Promise<string> {
  const spec = fixture.workflow as unknown as MasterWorkflowSpecification;
  const [wc] = await db.insert(workCenter).values({
    name: `conformance-${fixture.test_id}-${randomUUID()}`,
  }).returning();
  const [wf] = await db.insert(workflow).values({
    workCenterId: wc.id, oid: spec.oid, name: spec.local_id ?? spec.oid,
    version: spec.version ?? '1.0.0', state: 'Approved', specJsonb: spec,
  }).returning();
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'queued', queuedAt: new Date(),
    specJsonb: spec, startingParams: fixture.setup?.starting_parameters ?? null, runtimeNumber: 1,
    runtimeLabel: 'RW-1',
    masterName: spec.local_id ?? spec.oid, masterOid: spec.oid,
    masterVersion: spec.version ?? '1.0.0', masterState: 'Approved',
  }).returning();
  return wi.id as string;
}

function compareTrace(expected: SpecTraceEntry[], actual: SpecTraceEntry[]): string | null {
  if (expected.length !== actual.length) {
    return `Trace length mismatch: expected ${expected.length}, got ${actual.length}\n` +
      `  Expected: ${JSON.stringify(expected.map(e => `${e.step_oid}:${e.state}`))}\n` +
      `  Actual:   ${JSON.stringify(actual.map(e => `${e.step_oid}:${e.state}`))}`;
  }
  for (let i = 0; i < expected.length; i++) {
    const exp = expected[i];
    const act = actual[i];
    if (exp.step_oid !== act.step_oid) return `Trace[${i}] step_oid: expected "${exp.step_oid}", got "${act.step_oid}"`;
    if (exp.state !== act.state) return `Trace[${i}] state: expected "${exp.state}", got "${act.state}" (step ${exp.step_oid})`;
    // Order/after_action are compared ONLY when the fixture's expectation actually pins them —
    // and NEVER timestamp/error (SCRIPT vm-realm error strings diverge from the reference by
    // construction — Task 7's review verified no fixture pins a script error string).
    if (exp.order !== undefined && exp.order !== act.order) return `Trace[${i}] order: expected ${exp.order}, got ${act.order} (step ${exp.step_oid})`;
    if (exp.after_action !== undefined && exp.after_action !== act.after_action) return `Trace[${i}] after_action: expected ${exp.after_action}, got ${act.after_action} (step ${exp.step_oid})`;
  }
  return null;
}

function compareProperties(expected: Record<string, string>, actual: Record<string, string>): string | null {
  for (const [key, expectedValue] of Object.entries(expected)) {
    const actualValue = actual[key];
    if (actualValue !== expectedValue) return `Property "${key}": expected "${expectedValue}", got "${actualValue ?? '(undefined)'}"`;
  }
  return null;
}

const STATUS_TO_WORKFLOW_STATE: Record<string, string> = {
  completed: 'COMPLETED', aborted: 'ABORTED', errored: 'ERRORED', running: 'RUNNING', stopped: 'STOPPED',
};

function mapWorkflowState(status: string): string {
  return STATUS_TO_WORKFLOW_STATE[status] ?? status.toUpperCase();
}

async function runExecutionFixture(db: Db, fixture: TestFixture): Promise<FixtureResult> {
  // Validate first, fail fast (runner.ts:130) — every execution/parameters-category fixture in
  // the vendored set expects a valid spec; the 3 resource-category fixtures that expect
  // valid=false self-report category 'validation' and never reach this function.
  const valResult = validate(fixture.workflow);
  if (!valResult.valid) {
    return { pass: false, detail: `Validation failed: ${valResult.error_code}` };
  }

  const instanceId = await seedQueuedInstance(db, fixture);
  const deps = harnessDeps(fixture);
  await pumpUntilQuiet(db, deps);

  if (fixture.user_actions) {
    for (let i = 0; i < fixture.user_actions.length; i++) {
      await submitUserAction(db, instanceId, fixture.user_actions[i] as UserAction, i, deps);
      // submitUserAction already pumps its OWN instance to quiescence inside its own claimed
      // transaction (submit.ts's one sanctioned deviation) — this is a harmless safety net,
      // matching the established pattern in test/try-catch.test.ts's own fixture-driven loop.
      await pumpUntilQuiet(db, deps);
    }
  }

  const spec = fixture.workflow as unknown as MasterWorkflowSpecification;

  if (fixture.expected.execution_trace) {
    const rawRows = await db.select().from(traceEntry)
      .where(eq(traceEntry.workflowInstanceId, instanceId)).orderBy(asc(traceEntry.id));
    const actual = assembleReferenceTrace(rawRows.map((r): RawTraceRow => ({
      id: r.id, stepOid: r.stepOid, state: r.state, orderIndex: r.orderIndex ?? 0,
      error: r.error, afterAction: r.afterAction, at: r.at,
    })), spec);
    const traceErr = compareTrace(fixture.expected.execution_trace, actual);
    if (traceErr) return { pass: false, detail: `Trace mismatch: ${traceErr}` };
  }

  const [row] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, instanceId));

  if (fixture.expected.workflow_state) {
    const actualState = mapWorkflowState(row.status);
    if (actualState !== fixture.expected.workflow_state) {
      return { pass: false, detail: `Workflow state: expected "${fixture.expected.workflow_state}", got "${actualState}"` };
    }
  }

  if (fixture.expected.final_properties) {
    // Read from the ROOT property store (workflow_instance.property_store) — WorkflowContext
    // never persists a child's own props there (context.ts's persist() throws on a non-root
    // context), matching the reference's own getProperties() semantics: a child's PropertyStore
    // is purely internal, never itself exposed as "the" workflow's final properties.
    const propErr = compareProperties(fixture.expected.final_properties, (row.propertyStore as Record<string, string>) ?? {});
    if (propErr) return { pass: false, detail: `Property mismatch: ${propErr}` };
  }

  return { pass: true };
}

// ── entry point ──

export async function runFixture(db: Db, fixture: TestFixture): Promise<FixtureResult> {
  try {
    if (fixture.category === 'validation') {
      return runValidationFixture(fixture);
    }
    return await runExecutionFixture(db, fixture);
  } catch (err) {
    return { pass: false, detail: `Exception: ${(err as Error).message}` };
  }
}

// assembleReferenceTrace (the reference engine's trace-merge-order logic) now lives in
// core/trace-assembly.ts — moved there in Task 17 so the production history assembler
// (core/context.ts's settleTerminal) can share the EXACT same function rather than duplicating
// or re-deriving it (task-17-brief.md's binding TRACE MERGE ORDER ruling). See that module's
// doc comment for the full derivation this harness relied on unchanged. Re-exported here (not
// just imported) — test/conformance.test.ts's own import site predates the move and is left
// untouched rather than churned for its own sake.
export { assembleReferenceTrace, type RawTraceRow } from '../core/trace-assembly.js';
