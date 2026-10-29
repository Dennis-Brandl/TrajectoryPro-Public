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
// E-signature (spec 2026-09-06), e2e Task 8: the full operator loop against the live
// engine + served Cockpit for esignatureWorkflowPackage()'s two UI steps — a
// USER_INTERACTION carrying a required textInput plus an `esignature` block, and a
// YES_NO carrying an `esignature`-only block. Both blocks name a role defined in Mission
// Commander, "Time Sheet Approver" (D8: exact-name match, no tie-in between the two databases),
// granted PER WORK CENTER via sub-project 1's PUT /api/work-centers/:id/users/:userId/roles
// (spec 2026-09-06 D3).
//
// Test 1 drives the wrong-password/values-kept/password-cleared inline-error path (D-error
// path), the correct-credentials signed submit, the No route completing with NO
// credentials at all (D5: a `no` decision never requires or accepts a signature — the
// engine never even sees one), and the CM history Signatures section showing exactly the
// one successful signature. Test 2 drives `requireDifferentUser` (D2/D-different-user
// rule): the operator's own credentials are rejected on Yes with SIGNATURE_SAME_USER (a
// FAILED row, still audited per D6), a second user's credentials are accepted, and the
// history Signatures section shows all three attempts (1 signed + 1 failed + 1 signed) with
// the decision recorded on the successful Yes row.
//
// createWorkCenter/load: copied verbatim from cockpit.spec.ts (same not-imported rationale
// recorded there). findWorkCenter/findUser/assignToWorkCenter/createRole(+grantRole, split
// out of restrictNodeToNewRole's inline POST /api/roles + PUT .../roles — this spec never
// restricts a workflow NODE's allowed roles, since task offers here are plain WC-membership
// gated; only the e-signature block's OWN role check, resolved live by the engine, cares
// about the grant) are lifted from cockpit-chains.spec.ts. createRuntimeWorkflow mirrors
// cockpit-chains.spec.ts's createAndStartRw1 (== cockpit.spec.ts's own inline create+start).
// cardStatusText mirrors history.spec.ts's parametrized version (keyed on rwLabel, not
// hardcoded to RW-1). signInToCockpit factors cockpit-chains.spec.ts's openCockpit, minus
// the browser-context creation (the tests here already hold one from `browser.newContext()`).
//
// Every Cockpit button locator that could collide with the login screen's own "Password"
// label or with the multi-tab WorkView's inbox reopen button uses `exact: true` and/or is
// scoped to the e-signature fieldset (`getByRole('group', { name })` — the block's `label`
// is the <fieldset>'s <legend>, which IS its accessible name per ESignatureBlockView.tsx).
import { test, expect, type Page } from '@playwright/test';
import { bootstrapFirstAdmin, signIn } from './helpers/auth';
import { ADMIN, STEWARD, type DemoLogin } from './helpers/db';
import { esignatureWorkflowPackage, type FilePayload } from './helpers/packages';

const COCKPIT = 'http://localhost:3006';
const WC_A = 'E2E Signature Line';
const WC_B = 'E2E Signature Line B';
const ROLE = 'Time Sheet Approver';

async function createWorkCenter(page: Page, name: string) {
  await page.getByRole('button', { name: 'Work Centers' }).click(); // activity rail
  await page.getByRole('button', { name: 'New work center' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toBeHidden();
  // HierarchyPane's onSaved selects the new node.
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

async function load(page: Page, file: FilePayload) {
  await page.getByRole('button', { name: /Load packages/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Packages').setInputFiles([file]);
  await dialog.getByRole('button', { name: 'Load', exact: true }).click();
  // The results dialog replaces the load dialog.
  await expect(page.getByText('Load results')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();
}

// ---- JSON helpers over the admin session's cookie jar (page.request shares it with `page`).
// Route shapes verified against the CM route handlers (cockpit-chains.spec.ts's own
// comment): GET /work-centers wraps its list under { nodes }, GET /users under { users }.
async function findWorkCenter(page: Page, wcName: string): Promise<{ id: string }> {
  const wcs = (await (await page.request.get('/api/work-centers')).json()) as {
    nodes: Array<{ id: string; name: string }>;
  };
  const wc = wcs.nodes.find((w) => w.name === wcName);
  if (!wc) throw new Error(`work center not found: ${wcName}`);
  return wc;
}

async function findUser(page: Page, email: string): Promise<{ id: string }> {
  const users = (await (await page.request.get('/api/users')).json()) as {
    users: Array<{ id: string; email: string }>;
  };
  const user = users.users.find((u) => u.email === email);
  if (!user) throw new Error(`user not found: ${email}`);
  return user;
}

async function assignToWorkCenter(page: Page, wcName: string, email: string) {
  const wc = await findWorkCenter(page, wcName);
  const user = await findUser(page, email);
  const assign = await page.request.post(`/api/work-centers/${wc.id}/users/${user.id}`, { data: {} });
  expect(assign.ok()).toBeTruthy();
}

// POST /api/roles -> 201 RoleView { role: { id } } (cockpit-chains.spec.ts's
// restrictNodeToNewRole). Split out here since this spec never restricts a workflow node's
// allowed roles — only the e-signature block's own role check needs the grant below.
//
// Idempotent on the name (unlike restrictNodeToNewRole, which is only ever called with a
// FRESH name per spec run): both tests in this file create the SAME role name (`ROLE`,
// matching the fixture's `roleName: 'Time Sheet Approver'`), and `role.name` is a global
// unique column (not per-work-center) — a second create in the same suite run 409s, so
// this looks the name up first.
async function createRole(page: Page, name: string): Promise<string> {
  const list = (await (await page.request.get('/api/roles')).json()) as { roles: Array<{ id: string; name: string }> };
  const existing = list.roles.find((r) => r.name === name);
  if (existing) return existing.id;
  const created = await page.request.post('/api/roles', { data: { name } });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { role: { id: string } }).role.id;
}

// PUT /api/work-centers/:id/users/:userId/roles { roleIds } — sub-project 1's per-work-center
// role grant (spec 2026-09-06 D3). The user must already be a member (assignToWorkCenter
// runs first at every call site).
async function grantRole(page: Page, wcName: string, email: string, roleId: string) {
  const wc = await findWorkCenter(page, wcName);
  const user = await findUser(page, email);
  const granted = await page.request.put(`/api/work-centers/${wc.id}/users/${user.id}/roles`, { data: { roleIds: [roleId] } });
  expect(granted.ok()).toBeTruthy();
}

// Same create + start flow as cockpit.spec.ts / cockpit-chains.spec.ts's createAndStartRw1
// (phase 6: controls live in the card's detail dialog; RW-1 is 'pending' until started,
// hidden by the default Active chip). Load never navigates off the default "workflows" tab,
// so the create button is already visible here.
async function createRuntimeWorkflow(page: Page, wfName: string) {
  await page.getByRole('button', { name: `Create runtime workflow from ${wfName}` }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Create and Wait', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('RW-1 created — Waiting')).toBeVisible();
  await page.getByRole('tab', { name: 'Runtime' }).click();
  await page.getByRole('button', { name: 'All' }).click();
  await page.getByRole('button', { name: 'RW-1 details' }).click();
  await page.getByRole('button', { name: 'Start RW-1' }).click();
  await page.keyboard.press('Escape'); // close the dialog; the grid keeps polling
}

// Phase 6 card grid: the status badge is the card's one `span[title]`, read after the grid's
// own "Refresh" (RuntimeTab only refetches on an explicit refresh() call). Mirrors
// history.spec.ts's parametrized version — the admin page is left on the Runtime tab by
// createRuntimeWorkflow above and never navigated elsewhere before this is called.
async function cardStatusText(page: Page, rwLabel: string): Promise<string> {
  await page.getByRole('button', { name: 'Refresh' }).click();
  const card = page.getByRole('button', { name: `${rwLabel} details` }).locator('..');
  return ((await card.locator('span[title]').first().textContent()) ?? '').trim();
}

async function expectRunFinished(page: Page, wcName: string, rwLabel: string) {
  await expect(page.getByRole('heading', { name: wcName })).toBeVisible(); // the h1 is outside the Tabs, visible on every tab
  await expect.poll(async () => cardStatusText(page, rwLabel), { timeout: 30_000 }).toBe('Completed');
}

// history.spec.ts's idiom: the History tab's row is aria-labelled "History RW-{n}"
// (HistoryTable.tsx) and opens the flat-trace detail dialog (HistoryDetailDialog.tsx),
// which renders SignaturesSection below the trace.
async function openHistoryDetail(page: Page, wcName: string, rwLabel: string) {
  await expect(page.getByRole('heading', { name: wcName })).toBeVisible();
  await page.getByRole('tab', { name: 'History' }).click();
  await page.getByRole('button', { name: `History ${rwLabel}` }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

// Factors cockpit-chains.spec.ts's openCockpit, minus the browser-context creation (the
// tests below already hold one from `browser.newContext()` so a second operator can be
// opened later without disturbing this one).
async function signInToCockpit(cockpit: Page, login: DemoLogin, wcName: string) {
  await cockpit.goto(COCKPIT);
  await cockpit.getByLabel('Email').fill(login.email);
  await cockpit.getByLabel('Password').fill(login.password);
  await cockpit.getByRole('button', { name: 'Sign In', exact: true }).click();
  await cockpit.getByRole('button', { name: wcName, exact: true }).click();
}

// Waits for the named step's offer to arrive, then claims it — mirrors cockpit.spec.ts's
// single-operator claim idiom (`exact: true` on Claim; no auto-claim work center is used
// anywhere in this spec, so every step is a fresh offer, never a chained tab).
async function claimTask(cockpit: Page, stepName: string) {
  await expect(cockpit.getByText(stepName)).toBeVisible({ timeout: 30_000 });
  await cockpit.getByRole('button', { name: 'Claim', exact: true }).click();
}

test('signed submit: wrong password stays inline with values kept; the approver signs; No needs no signature; history lists one signature', async ({ page, request, browser }) => {
  await bootstrapFirstAdmin(request);
  await signIn(page, ADMIN.email, ADMIN.password);
  await createWorkCenter(page, WC_A);
  await load(page, esignatureWorkflowPackage({ localId: 'Signed flow', oid: 'e2e-esig-1' }));
  // Operator (steward) is a plain member; the administrator is a member holding the role.
  await assignToWorkCenter(page, WC_A, STEWARD.email);
  await assignToWorkCenter(page, WC_A, ADMIN.email);
  const roleId = await createRole(page, ROLE);                     // POST /api/roles -> id
  await grantRole(page, WC_A, ADMIN.email, roleId);                 // PUT /api/work-centers/:id/users/:userId/roles { roleIds: [roleId] }
  await createRuntimeWorkflow(page, 'Signed flow');                 // as cockpit.spec.ts starts RW-1

  const operator = await browser.newContext();
  const cockpit = await operator.newPage();
  await signInToCockpit(cockpit, STEWARD, WC_A);
  await claimTask(cockpit, 'Sign here');

  await cockpit.getByLabel('Reason').fill('Overtime on Friday');
  const esig = cockpit.getByRole('group', { name: 'Approve' });     // the <fieldset> legend is its accessible name
  await expect(esig.getByText('Sign as: Time Sheet Approver')).toBeVisible();
  await esig.getByLabel('Login name').fill(ADMIN.loginName!);
  await esig.getByLabel('Password').fill('wrong-password');
  await cockpit.getByRole('button', { name: 'Sign & Continue' }).click();
  await expect(cockpit.getByRole('alert')).toHaveText('Login name or password is incorrect');
  await expect(cockpit.getByLabel('Reason')).toHaveValue('Overtime on Friday');   // values kept, no navigation
  await expect(esig.getByLabel('Password')).toHaveValue('');                        // password cleared

  await esig.getByLabel('Password').fill(ADMIN.password);
  await cockpit.getByRole('button', { name: 'Sign & Continue' }).click();
  await claimTask(cockpit, 'Approve?');                             // the step completed and the decision step is now offered
  await expect(cockpit.getByRole('button', { name: 'Sign & Approve' })).toBeVisible();
  await cockpit.getByRole('button', { name: 'Reject' }).click();    // No: no credentials, takes the No route
  await expectRunFinished(page, WC_A, 'RW-1');                      // history row appears as Completed

  await openHistoryDetail(page, WC_A, 'RW-1');
  const dialog = page.getByRole('dialog');
  // D6: every attempt is an audit row — the earlier wrong-password attempt is a `failed`
  // row alongside the correct-password `signed` one, so this is 2, not 1; the Reject/No
  // decision itself writes no row (D5). Both rows are further filtered on the parenthesized
  // login name because the Trace section above the Signatures section ALSO names the role
  // on its own SIGNED line ("Sign here · SIGNED · … · admin as Time Sheet Approver"), which
  // would otherwise collide with a bare "Time Sheet Approver" text filter.
  await dialog.getByRole('button', { name: 'Show signatures (2)' }).click();
  const signatureRows = dialog.getByRole('listitem').filter({ hasText: `(${ADMIN.loginName})` });
  await expect(signatureRows).toHaveCount(2);
  await expect(signatureRows.filter({ hasText: 'Time Sheet Approver' })).toHaveCount(2);
  await expect(signatureRows.filter({ hasText: 'failed: SIGNATURE_INVALID_CREDENTIALS' })).toHaveCount(1);
  await operator.close();
});

test('requireDifferentUser on the decision step: the operator cannot sign Yes; the approver can; history records decision yes', async ({ page, request, browser }) => {
  await bootstrapFirstAdmin(request);
  await signIn(page, ADMIN.email, ADMIN.password);
  await createWorkCenter(page, WC_B);
  await load(page, esignatureWorkflowPackage({ localId: 'Signed decision', oid: 'e2e-esig-2', requireDifferentUser: true }));
  await assignToWorkCenter(page, WC_B, STEWARD.email);
  await assignToWorkCenter(page, WC_B, ADMIN.email);
  const roleId = await createRole(page, ROLE);
  await grantRole(page, WC_B, STEWARD.email, roleId);               // both hold the role; the flag is what blocks the operator
  await grantRole(page, WC_B, ADMIN.email, roleId);
  await createRuntimeWorkflow(page, 'Signed decision');

  const operator = await browser.newContext();
  const cockpit = await operator.newPage();
  await signInToCockpit(cockpit, STEWARD, WC_B);
  await claimTask(cockpit, 'Sign here');
  await cockpit.getByLabel('Reason').fill('r');
  const first = cockpit.getByRole('group', { name: 'Approve' });
  await first.getByLabel('Login name').fill(STEWARD.loginName!);     // the operator signs the first step themselves (flag off there)
  await first.getByLabel('Password').fill(STEWARD.password);
  await cockpit.getByRole('button', { name: 'Sign & Continue' }).click();

  await claimTask(cockpit, 'Approve?');
  const decide = cockpit.getByRole('group', { name: 'Decide' });
  await expect(decide.getByText(/Must be signed by someone other than/)).toBeVisible();
  await expect(decide.getByLabel('Login name')).toHaveValue('');   // no prefill under the flag
  await decide.getByLabel('Login name').fill(STEWARD.loginName!);
  await decide.getByLabel('Password').fill(STEWARD.password);
  await cockpit.getByRole('button', { name: 'Sign & Approve' }).click();
  await expect(cockpit.getByRole('alert')).toHaveText('A different user than the operator must sign');
  await decide.getByLabel('Login name').fill(ADMIN.loginName!);
  await decide.getByLabel('Password').fill(ADMIN.password);
  await cockpit.getByRole('button', { name: 'Sign & Approve' }).click();
  await expectRunFinished(page, WC_B, 'RW-1');

  await openHistoryDetail(page, WC_B, 'RW-1');
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Show signatures (3)' }).click();   // 1 signed (step 1) + 1 failed (same user) + 1 signed (yes)
  await expect(dialog.getByRole('listitem').filter({ hasText: 'failed: SIGNATURE_SAME_USER' })).toHaveCount(1);
  await expect(dialog.getByRole('listitem').filter({ hasText: `(${ADMIN.loginName}) · Time Sheet Approver · yes` })).toHaveCount(1);
  await operator.close();
});
