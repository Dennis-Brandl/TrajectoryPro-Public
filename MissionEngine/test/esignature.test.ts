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
// Spec 2026-09-06 D4-D9: the operator API's submit route verifies an e-signature (findESignatureBlock
// + verifySignature), writes the audit row (signed inside the completion transaction, failed outside
// it), records a SIGNED trace entry, and overrides the bound output with the signer's display name.
// Reuses Task 8/9/10's operator-API harness (test/helpers/api.ts) and the seeding/reader helpers
// established in test/api-assignments.test.ts, plus the `step()` builder from test/form-document.test.ts.
import { expect, test } from 'vitest';
import { and, asc, eq } from 'drizzle-orm';
import {
  role, stepSignature, traceEntry, workCenterUser, appUser,
  workCenter, workflow, workflowInstance, stepInstance, instanceAssignment,
} from 'mission-control-db/src/db/schema/index';
import { makeApi, type ApiHarness } from './helpers/api.js';
import { pumpUntilQuiet } from './helpers/pump.js';
import { findESignatureBlock } from '../src/core/esignature.js';

type TestDb = ApiHarness['db'];

const jsonHeaders = (cookie: string) => ({ cookie, 'content-type': 'application/json' });

const step = (oid: string, step_type: string, extra: Record<string, unknown> = {}) => ({
  local_id: oid, oid, step_type, version: '1.0.0', last_modified_date: '2026-01-01', ...extra,
});

interface SeededInstance { id: string; workCenterId: string; runtimeNumber: number; runtimeLabel: string; }

// Deliberately NOT 'RW-<runtimeNumber>'-shaped (spec 2026-10-07 §4.1 review finding): a label
// derived from runtimeNumber would make every assertion below pass even if the production code
// under test were wrongly reconstructing the label as `RW-${row.runtimeNumber}` instead of
// reading the frozen row.runtimeLabel — see history.test.ts's own 'MIX-20261007-001' fixture for
// the same reasoning.
const FIXED_RUNTIME_LABEL = 'MIX-20261007-001';

async function seedQueued(db: TestDb, spec: unknown, oid: string): Promise<SeededInstance> {
  const [wc] = await db.insert(workCenter).values({ name: `wc-${Math.random()}` }).returning();
  const [wf] = await db.insert(workflow).values({
    workCenterId: wc.id, oid, name: oid, version: '1.0.0', state: 'Approved', specJsonb: spec,
  }).returning();
  const runtimeNumber = Math.floor(Math.random() * 1_000_000) + 1;
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'queued', queuedAt: new Date(),
    specJsonb: spec, startingParams: null, runtimeNumber, runtimeLabel: FIXED_RUNTIME_LABEL,
    masterName: oid, masterOid: oid, masterVersion: '1.0.0', masterState: 'Approved',
  }).returning();
  return { id: wi.id, workCenterId: wc.id, runtimeNumber, runtimeLabel: wi.runtimeLabel };
}

async function stepRow(db: TestDb, instanceId: string, stepOid: string) {
  const rows = await db.select().from(stepInstance).where(eq(stepInstance.workflowInstanceId, instanceId));
  return rows.find((r) => r.stepOid === stepOid);
}

async function instanceRow(db: TestDb, instanceId: string) {
  const [row] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, instanceId));
  return row;
}

/** The single 'offered' instance_assignment row for this instance (every spec here parks at
 *  most one step at a time). */
async function offeredAssignmentId(db: TestDb, instanceId: string): Promise<string> {
  const rows = await db.select({ id: instanceAssignment.id, status: instanceAssignment.status })
    .from(instanceAssignment)
    .innerJoin(stepInstance, eq(instanceAssignment.stepInstanceId, stepInstance.id))
    .where(eq(stepInstance.workflowInstanceId, instanceId));
  const offered = rows.find((r) => r.status === 'offered');
  if (!offered) throw new Error(`no offered assignment for instance ${instanceId}`);
  return offered.id;
}

const ESIG_BLOCK = (extra: Record<string, unknown> = {}) => ({
  id: 'b2', type: 'esignature', fieldName: 'approval', label: 'Approve', meaning: 'I approve this record',
  roleName: 'QA Lead', outputParameter: 'Response.Approver', ...extra,
});
const FORM_DOC = (esig: Record<string, unknown> | null) => ({
  version: 2,
  sections: [{ id: 'sec1', role: 'content', rows: [{ id: 'r1', blocks: [
    { id: 'b1', type: 'textInput', fieldName: 'note', label: 'Note', outputParameter: 'Response.Note' },
    ...(esig ? [esig] : []),
  ] }] }],
});
const specWith = (oid: string, uiExtra: Record<string, unknown>, yesNo = false) => ({
  local_id: oid, oid, version: '1.0.0', last_modified_date: '2026-01-01', schemaVersion: '5.0',
  steps: [
    step('s1', 'START'),
    step('ui-1', yesNo ? 'YES_NO' : 'USER_INTERACTION', {
      output_parameter_specifications: [
        { id: 'Response.Note', target: 'Response.Note' },
        { id: 'Response.Approver', target: 'Response.Approver' },
      ],
      ...uiExtra,
    }),
    ...(yesNo ? [step('end-yes', 'END'), step('end-no', 'END')] : [step('e1', 'END')]),
  ],
  connections: yesNo
    ? [{ from_step_id: 's1', to_step_id: 'ui-1' }, { from_step_id: 'ui-1', to_step_id: 'end-yes', source_handle_id: 'yes' }, { from_step_id: 'ui-1', to_step_id: 'end-no', source_handle_id: 'no' }]
    : [{ from_step_id: 's1', to_step_id: 'ui-1' }, { from_step_id: 'ui-1', to_step_id: 'e1' }],
});
// Same connection shape as YESNO_SPEC in test/api-assignments.test.ts (source_handle_id carries the branch).
const outputParam = async (db: TestDb, instanceId: string, key: string) =>
  ((await instanceRow(db, instanceId)).propertyStore as Record<string, string> | null)?.[key];

async function claimed(spec: unknown, oid: string) {
  const h = await makeApi();
  const wi = await seedQueued(h.db, spec, oid);
  await pumpUntilQuiet(h.db, h.deps);
  const operatorId = await h.seedOperator('op@example.com', wi.workCenterId);
  const cookie = await h.cookieFor('op@example.com');
  const assignmentId = await offeredAssignmentId(h.db, wi.id);
  expect((await h.app.request(`/api/assignments/${assignmentId}/claim`, { method: 'POST', headers: { cookie } })).status).toBe(200);
  const [qa] = await h.db.insert(role).values({ name: 'QA Lead' }).returning();
  // The signer: a member holding the role; login name derived from the email by the 0031 trigger → 'jane'.
  const signerId = await h.seedOperator('jane@example.com', wi.workCenterId, 'signer-pw-1');
  await h.grantRoles(signerId, wi.workCenterId, [qa.id]);
  const submit = (body: unknown) => h.app.request(`/api/assignments/${assignmentId}/submit`, { method: 'POST', headers: jsonHeaders(cookie), body: JSON.stringify(body) });
  // Review fix (fix round 1, finding 4): ordered — matches the DAO's listStepSignatures order —
  // so the row-order assertions below (rows[0]/[1]/[3], a failureCode-order .toEqual) are not
  // riding on incidental heap order, which a real-Postgres run need not preserve.
  const rows = () => h.db.select().from(stepSignature).where(eq(stepSignature.workflowInstanceId, wi.id))
    .orderBy(asc(stepSignature.signedAt), asc(stepSignature.id));
  return { ...h, wi, operatorId, signerId, qa, assignmentId, submit, rows };
}

test('400 SIGNATURE_REQUIRED when the block is present and the credentials are missing or blank; no audit row', async () => {
  const t = await claimed(specWith('wf-esig-req', { form_document: FORM_DOC(ESIG_BLOCK()) }), 'wf-esig-req');
  for (const body of [
    { kind: 'submit', values: { note: 'n' } },
    { kind: 'submit', values: { note: 'n' }, signature: { loginName: ' ', password: 'x' } },
    { kind: 'submit', values: { note: 'n' }, signature: { loginName: 'jane', password: '' } },
  ]) {
    const res = await t.submit(body);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('SIGNATURE_REQUIRED');
  }
  expect(await t.rows()).toHaveLength(0);
  expect((await stepRow(t.db, t.wi.id, 'ui-1'))?.state).toBe('WAITING_USER');
  await t.close();
});

// Review fix (fix round 1, finding 1): the gate keys on the RESULTING action, not on body.kind —
// `{kind:'complete'}` produces the exact same engine action as an empty submit ({step_oid,
// action:'submit', form_values:{}}), so it must be gated identically, not waved through.
test('kind:"complete" on an esignature step cannot bypass the gate: 400 SIGNATURE_REQUIRED, step stays open, no row', async () => {
  const t = await claimed(specWith('wf-esig-complete', { form_document: FORM_DOC(ESIG_BLOCK()) }), 'wf-esig-complete');
  const res = await t.submit({ kind: 'complete' });
  expect(res.status).toBe(400);
  expect(((await res.json()) as { code: string }).code).toBe('SIGNATURE_REQUIRED');
  expect((await stepRow(t.db, t.wi.id, 'ui-1'))?.state).toBe('WAITING_USER');
  expect(await t.rows()).toHaveLength(0);
  await t.close();
});

test('403 per verification code, each with a failed audit row; the step stays open', async () => {
  const t = await claimed(specWith('wf-esig-403', { form_document: FORM_DOC(ESIG_BLOCK({ requireDifferentUser: true })) }), 'wf-esig-403');
  // an active user outside the work center, and a disabled member
  const outsiderId = await t.seedOperator('outsider@example.com', undefined, 'out-pw-1');
  const disabledId = await t.seedOperator('gone@example.com', t.wi.workCenterId, 'gone-pw-1');
  await t.db.update(appUser).set({ status: 'disabled' }).where(eq(appUser.id, disabledId));
  const cases: [Record<string, string>, string][] = [
    [{ loginName: 'nobody', password: 'x' }, 'SIGNATURE_INVALID_CREDENTIALS'],
    [{ loginName: 'jane', password: 'wrong' }, 'SIGNATURE_INVALID_CREDENTIALS'],
    [{ loginName: 'gone', password: 'gone-pw-1' }, 'SIGNATURE_INVALID_CREDENTIALS'],
    [{ loginName: 'op', password: 'password-123' }, 'SIGNATURE_SAME_USER'],
    [{ loginName: 'outsider', password: 'out-pw-1' }, 'SIGNATURE_NOT_MEMBER'],
  ];
  for (const [signature, code] of cases) {
    const res = await t.submit({ kind: 'submit', values: { note: 'n' }, signature });
    expect(res.status, code).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe(code);
  }
  const rows = await t.rows();
  expect(rows.map((r) => r.failureCode)).toEqual(cases.map(([, code]) => code));
  expect(rows.every((r) => r.outcome === 'failed')).toBe(true);
  // Spec 2026-10-07 §4.1: the failed-audit write (app.ts) freezes the instance's real
  // runtimeLabel, not a reconstruction — see FIXED_RUNTIME_LABEL's own comment above.
  expect(rows.every((r) => r.runtimeLabel === t.wi.runtimeLabel)).toBe(true);
  expect(rows[0]).toMatchObject({ signerLoginName: 'nobody', signerUserId: null, signerDisplayName: null, operatorUserId: t.operatorId, operatorLoginName: 'op', stepOid: 'ui-1', stepName: 'ui-1' });
  expect(rows[1]).toMatchObject({ signerLoginName: 'jane', signerUserId: t.signerId });
  expect(rows[3]).toMatchObject({ signerUserId: t.operatorId });
  expect((await stepRow(t.db, t.wi.id, 'ui-1'))?.state).toBe('WAITING_USER');
  await t.close();
});

// Review fix (fix round 1, finding 2): verification and the failed-row write must never run for
// a caller who isn't the claimant — otherwise any authenticated user who can see an assignment id
// could use this route as a password oracle and write compliance rows against a step they don't
// hold, stamped with themselves as the operator.
//
// Final-review fix: this MUST send a WRONG password. With Jane's correct password, an engine that
// dropped the pre-check entirely would still land on 409/zero-rows — verification would succeed,
// submitCore's FOR UPDATE claim guard would then throw NOT_CLAIMANT, the transaction would roll
// back, and the row count would stay zero: identical observables to the pre-check firing. Only a
// WRONG password discriminates the two: no pre-check → verifySignature runs → SIGNATURE_INVALID_CREDENTIALS
// → a `failed` audit row is written → 403; pre-check present → 409 NOT_CLAIMANT, zero rows, before
// verifySignature (and the audit-row write) ever runs.
test('a non-claimant cannot drive signature verification or write audit rows: 409 NOT_CLAIMANT, zero rows', async () => {
  const t = await claimed(specWith('wf-esig-notclaimant', { form_document: FORM_DOC(ESIG_BLOCK()) }), 'wf-esig-notclaimant');
  await t.seedOperator('mallory@example.com', t.wi.workCenterId, 'mallory-pw-1');
  const malloryCookie = await t.cookieFor('mallory@example.com', 'mallory-pw-1');
  const res = await t.app.request(`/api/assignments/${t.assignmentId}/submit`, {
    method: 'POST', headers: jsonHeaders(malloryCookie),
    body: JSON.stringify({ kind: 'submit', values: { note: 'n' }, signature: { loginName: 'jane', password: 'wrong-password' } }),
  });
  expect(res.status).toBe(409);
  expect(((await res.json()) as { code: string }).code).toBe('NOT_CLAIMANT');
  expect(await t.rows()).toHaveLength(0);
  await t.close();
});

test('role codes: unknown role → SIGNATURE_ROLE_UNKNOWN naming it; member without the role → SIGNATURE_ROLE_MISSING', async () => {
  const t = await claimed(specWith('wf-esig-role', { form_document: FORM_DOC(ESIG_BLOCK({ roleName: 'Ghost Role' })) }), 'wf-esig-role');
  const res = await t.submit({ kind: 'submit', values: {}, signature: { loginName: 'jane', password: 'signer-pw-1' } });
  expect(res.status).toBe(403);
  const body = (await res.json()) as { code: string; error: string };
  expect(body.code).toBe('SIGNATURE_ROLE_UNKNOWN');
  expect(body.error).toContain('Ghost Role');
  await t.close();

  const t2 = await claimed(specWith('wf-esig-role-2', { form_document: FORM_DOC(ESIG_BLOCK()) }), 'wf-esig-role-2');
  const plainId = await t2.seedOperator('plain@example.com', t2.wi.workCenterId, 'plain-pw-1');
  const res2 = await t2.submit({ kind: 'submit', values: {}, signature: { loginName: 'plain', password: 'plain-pw-1' } });
  expect(res2.status).toBe(403);
  expect(((await res2.json()) as { code: string }).code).toBe('SIGNATURE_ROLE_MISSING');
  expect((await t2.rows())[0]).toMatchObject({ signerUserId: plainId, roleName: 'QA Lead', roleId: t2.qa.id });
  await t2.close();
});

test('success: signed row, SIGNED trace, bound output = display name (client value ignored), step completes', async () => {
  const t = await claimed(specWith('wf-esig-ok', { form_document: FORM_DOC(ESIG_BLOCK()) }), 'wf-esig-ok');
  const res = await t.submit({ kind: 'submit', values: { note: 'hello', approval: 'forged' }, signature: { loginName: ' Jane ', password: 'signer-pw-1' } });
  expect(res.status).toBe(200);
  expect((await stepRow(t.db, t.wi.id, 'ui-1'))?.state).toBe('COMPLETED');
  const rows = await t.rows();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    outcome: 'signed', failureCode: null, signerUserId: t.signerId, signerLoginName: 'jane', signerDisplayName: 'jane@example.com',
    roleId: t.qa.id, roleName: 'QA Lead', operatorUserId: t.operatorId, operatorLoginName: 'op',
    stepOid: 'ui-1', stepName: 'ui-1', runtimeNumber: t.wi.runtimeNumber, runtimeLabel: t.wi.runtimeLabel, workCenterId: t.wi.workCenterId, meaning: 'I approve this record', decision: null,
  });
  expect(rows[0].stepInstanceId).toBeTruthy();
  const traces = await t.db.select().from(traceEntry).where(and(eq(traceEntry.workflowInstanceId, t.wi.id), eq(traceEntry.state, 'SIGNED')));
  expect(traces).toHaveLength(1);
  expect(traces[0].error).toBe('jane as QA Lead');
  // The bound output parameter carries the signer's DISPLAY NAME, not the client's value — read it
  // the same way test/form-document.test.ts reads Response.Name after a submit.
  expect(await outputParam(t.db, t.wi.id, 'Response.Approver')).toBe('jane@example.com');
  expect(await outputParam(t.db, t.wi.id, 'Response.Note')).toBe('hello');
  await t.close();
});

// Final-review addition: requireDifferentUser is opt-in (false/absent by default) — an operator
// signing their own submission with their own credentials must succeed when the block doesn't ask
// for a different signer. (SIGNATURE_SAME_USER, exercised above, only fires when the block sets
// requireDifferentUser: true.)
test('requireDifferentUser false/absent: the operator can sign with their own credentials (signed row, 200)', async () => {
  const t = await claimed(specWith('wf-esig-sameuser-ok', { form_document: FORM_DOC(ESIG_BLOCK()) }), 'wf-esig-sameuser-ok');
  await t.grantRoles(t.operatorId, t.wi.workCenterId, [t.qa.id]);
  const res = await t.submit({ kind: 'submit', values: { note: 'n' }, signature: { loginName: 'op', password: 'password-123' } });
  expect(res.status).toBe(200);
  const rows = await t.rows();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ outcome: 'signed', failureCode: null, signerLoginName: 'op', signerUserId: t.operatorId, operatorUserId: t.operatorId, roleId: t.qa.id, roleName: 'QA Lead' });
  await t.close();
});

// Review fix (fix round 1, finding 3): a malformed block missing fieldName must fail CLOSED —
// still found, still gating, just with nothing to bind the signer's display name into.
test('an esignature block without fieldName still requires and records a signature; no output binding is written', async () => {
  const t = await claimed(specWith('wf-esig-nofield', { form_document: FORM_DOC({ id: 'b2', type: 'esignature', label: 'Approve', roleName: 'QA Lead' }) }), 'wf-esig-nofield');
  const blocked = await t.submit({ kind: 'submit', values: { note: 'n' } });
  expect(blocked.status).toBe(400);
  expect(((await blocked.json()) as { code: string }).code).toBe('SIGNATURE_REQUIRED');
  const res = await t.submit({ kind: 'submit', values: { note: 'n' }, signature: { loginName: 'jane', password: 'signer-pw-1' } });
  expect(res.status).toBe(200);
  expect((await t.rows())[0]).toMatchObject({ outcome: 'signed', signerLoginName: 'jane' });
  expect(await outputParam(t.db, t.wi.id, 'Response.Note')).toBe('n');
  expect(await outputParam(t.db, t.wi.id, 'Response.Approver')).toBeUndefined();
  await t.close();
});

test('YES_NO: No completes without a signature (none accepted, no row); Yes requires one and records decision=yes', async () => {
  const yes = await claimed(specWith('wf-esig-yes', { form_document: FORM_DOC(ESIG_BLOCK()) }, true), 'wf-esig-yes');
  expect((await yes.submit({ kind: 'decision', value: 'yes' })).status).toBe(400);
  const ok = await yes.submit({ kind: 'decision', value: 'yes', signature: { loginName: 'jane', password: 'signer-pw-1' } });
  expect(ok.status).toBe(200);
  expect((await stepRow(yes.db, yes.wi.id, 'end-yes'))?.state).toBe('COMPLETED');
  expect((await yes.rows())[0]).toMatchObject({ outcome: 'signed', decision: 'yes' });
  // Final-review addition: the YES_NO signed path binds the output the same way the plain-submit
  // path does (spec D8) — the signer's display name, not any client-supplied value.
  expect(await outputParam(yes.db, yes.wi.id, 'Response.Approver')).toBe('jane@example.com');
  await yes.close();

  const no = await claimed(specWith('wf-esig-no', { form_document: FORM_DOC(ESIG_BLOCK()) }, true), 'wf-esig-no');
  const res = await no.submit({ kind: 'decision', value: 'no', signature: { loginName: 'nobody', password: 'ignored' } });
  expect(res.status).toBe(200);
  expect((await stepRow(no.db, no.wi.id, 'end-no'))?.state).toBe('COMPLETED');
  expect(await no.rows()).toHaveLength(0);
  await no.close();
});

test('a document without the block ignores a stray signature field', async () => {
  const t = await claimed(specWith('wf-esig-none', { form_document: FORM_DOC(null) }), 'wf-esig-none');
  const res = await t.submit({ kind: 'submit', values: { note: 'n' }, signature: { loginName: 'nobody', password: 'x' } });
  expect(res.status).toBe(200);
  expect(await t.rows()).toHaveLength(0);
  await t.close();
});

test('findESignatureBlock: first block in document order; null for absent/malformed documents', () => {
  expect(findESignatureBlock(FORM_DOC(ESIG_BLOCK()))).toMatchObject({ fieldName: 'approval', roleName: 'QA Lead', outputParameter: 'Response.Approver' });
  expect(findESignatureBlock(FORM_DOC(null))).toBeNull();
  expect(findESignatureBlock(undefined)).toBeNull();
  expect(findESignatureBlock({ sections: 'nope' })).toBeNull();
  const two = FORM_DOC(ESIG_BLOCK());
  (two.sections[0].rows[0].blocks as unknown[]).unshift({ id: 'b0', type: 'esignature', fieldName: 'first' });
  expect(findESignatureBlock(two)?.fieldName).toBe('first');
});

// Review fix (fix round 1, finding 3): matching used to require a string fieldName, which made a
// malformed block (author dropped fieldName) invisible — findESignatureBlock returned null and the
// step submitted with no signature at all, silently. It now fails CLOSED: still found, fieldName
// degrades to '' (an honest string, not undefined) rather than un-finding the whole block.
test('findESignatureBlock: a block missing fieldName is still found (fails closed), fieldName is the empty string', () => {
  const doc = FORM_DOC({ id: 'b2', type: 'esignature', roleName: 'QA Lead' });
  const block = findESignatureBlock(doc);
  expect(block).not.toBeNull();
  expect(block?.fieldName).toBe('');
  expect(block?.roleName).toBe('QA Lead');
});
