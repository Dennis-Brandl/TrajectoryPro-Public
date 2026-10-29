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
// Auto-claim chains, phase 4 (spec 2026-08-14 §7, e2e bullet) — the assembled loop:
// CM turns the work center's "Auto-claim follow-on steps" on; the engine chains follow-on
// steps to the operator who claimed first (D1/D6) — across a non-UI SCRIPT step and a
// PARALLEL fan-out (D3: every branch) — stops at the child-workflow boundary (D6: the
// child's first step is a fresh scope with no chain memory). With TWO operators online and
// the child role restricted to a SECOND operator, that boundary now auto-claims rather than
// offers: the sole-candidate rule (spec 2026-08-17 D11) sees exactly one online holder of the
// child role and claims the child's first step for that operator at birth, so it arrives as a
// tab and never touches "Available". The chain then continues inside the child to THAT
// operator, and resumes the parent's chain when the child completes: the parent's next step
// activates in the second operator's submit transaction and still auto-claims to the first
// (chain memory is per scope, not per submitter). The Cockpit's WorkView shows every chained
// or sole-candidate-claimed step as a tab — never a trip through "Available". Test 2 drives
// the one operator action no unit suite runs through the assembled view: self-release of a
// chained step (D5: a sibling branch's submit runs reconcile while the released offer sits in
// the pool and must not re-steal it; the chain resumes once the operator re-claims and
// completes it). Test 3 is the zero-claim loop: a single online operator is the sole
// candidate for every scope in the run, parent and child alike, so the whole chain — including
// the very first step, born with nobody online (the RW-15 shape) — flows to tabs with no
// Claim click anywhere.
//
// Two operators = two browser contexts (separate cookie jars): STEWARD is the line
// operator; ADMIN doubles as the reviewer, holding a fresh "E2E Reviewer" role that is the
// child node's ONLY allowed role. On the engine side both are plain work-center members.
//
// createWorkCenter/load/cardStatusText/user-assign: copied from cockpit.spec.ts (same
// not-imported rationale recorded in mission-engine.spec.ts), createWorkCenter extended
// with the auto-claim checkbox. Every Cockpit button locator uses exact:true — the inbox's
// "My tasks" reopen button is named "<step> <workflow> · RW-n", so a substring name can bind
// to it in the one-frame window between a claim's refresh and the pane taking focus (the
// cockpit.spec.ts baseline failure of 2026-08-16). Only the focused pane is visible (the
// rest carry the HTML `hidden` attribute, which role queries exclude), so an unscoped
// getByRole('button', { name: 'Continue', exact: true }) is the visible pane's button.
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { bootstrapFirstAdmin, signIn } from './helpers/auth';
import { ADMIN, STEWARD, type DemoLogin } from './helpers/db';
import { chainWorkflowPackage, chainReleaseWorkflowPackage, type FilePayload } from './helpers/packages';

const COCKPIT = 'http://localhost:3006';
const WC_NAME = 'E2E Chain WC';
const WF_NAME = 'E2E Chain Workflow';
const WC_NAME_2 = 'E2E Chain Release WC';
const WF_NAME_2 = 'E2E Chain Release Workflow';
const WC_NAME_3 = 'E2E Sole WC';
const WF_NAME_3 = 'E2E Sole Workflow';
const REVIEWER_ROLE = 'E2E Reviewer';

// cockpit.spec.ts's createWorkCenter plus the phase-1 setting this whole spec exercises:
// WorkCenterDialog.tsx renders <input id="wc-auto-claim" type="checkbox"> labelled
// "Auto-claim follow-on steps" (workflow.auto_claim stays null → inherits the WC's true).
async function createAutoClaimWorkCenter(page: Page, name: string) {
  await page.getByRole('button', { name: 'Work Centers' }).click(); // activity rail
  await page.getByRole('button', { name: 'New work center' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByLabel('Auto-claim follow-on steps').check();
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

// Phase 6 card grid: the status badge is the card's one `span[title]`, read after the grid's
// own "Refresh" (see mission-engine.spec.ts for the full rationale). The detail dialog must
// be closed (Escape) before calling this.
async function cardStatusText(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Refresh' }).click();
  // The overlay button (D4) is empty; the badge lives in its parent card div.
  const card = page.getByRole('button', { name: 'RW-1 details' }).locator('..');
  return ((await card.locator('span[title]').first().textContent()) ?? '').trim();
}

// ---- JSON helpers over the admin session's cookie jar (page.request shares it with `page`).
// Route shapes verified against the CM route handlers, not assumed: GET /work-centers wraps
// under { nodes }, GET /users under { users }, GET /work-centers/:id carries { workflows },
// the WC user-assign is POST /work-centers/:id/users/:userId.
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

// Creates `roleName`, grants it to `email`, and makes it the ONLY allowed role of the
// workflow node named `nodeName` — the child spec's local_id ("Review"), which is what CM's
// ingest stores as workflow_node.name. Routes: POST /api/roles → 201 RoleView { role: { id } };
// PUT /api/work-centers/:id/users/:userId/roles; GET+PUT /api/workflows/:id/allowed-roles — the
// view lists UI-step-owning nodes plus their ancestors as { nodeId, nodeName, ... }, and the PUT
// body is the WHOLE desired grant set, so nodes left out (the parent) stay unrestricted. Grants
// on a child-workflow node bind every UI step nested under it (nearest-ancestor resolution), so
// both child steps require the reviewer role.
async function restrictNodeToNewRole(
  page: Page, wcName: string, wfName: string, nodeName: string, roleName: string, email: string,
) {
  const created = await page.request.post('/api/roles', { data: { name: roleName } });
  expect(created.status()).toBe(201);
  const roleId = ((await created.json()) as { role: { id: string } }).role.id;
  const wc = await findWorkCenter(page, wcName);
  const user = await findUser(page, email);
  // Spec 2026-09-06 D3: roles are granted PER WORK CENTER; the user must already be a member
  // (assignToWorkCenter runs before this helper at every call site).
  const granted = await page.request.put(`/api/work-centers/${wc.id}/users/${user.id}/roles`, { data: { roleIds: [roleId] } });
  expect(granted.ok()).toBeTruthy();

  const view = (await (await page.request.get(`/api/work-centers/${wc.id}`)).json()) as {
    workflows: Array<{ id: string; name: string }>;
  };
  const wf = view.workflows.find((w) => w.name === wfName);
  if (!wf) throw new Error(`workflow not found in ${wcName}: ${wfName}`);

  const roles = (await (await page.request.get(`/api/workflows/${wf.id}/allowed-roles`)).json()) as {
    nodes: Array<{ nodeId: string; nodeName: string }>;
  };
  const node = roles.nodes.find((n) => n.nodeName === nodeName);
  if (!node) {
    throw new Error(`workflow node not found: ${nodeName} (have: ${roles.nodes.map((n) => n.nodeName).join(', ')})`);
  }
  const put = await page.request.put(`/api/workflows/${wf.id}/allowed-roles`, {
    data: { nodes: [{ nodeId: node.nodeId, roleIds: [roleId] }] },
  });
  expect(put.ok()).toBeTruthy();
}

// Same create + start flow as cockpit.spec.ts (phase 6: controls live in the card's detail
// dialog; RW-1 is 'pending' until started, hidden by the default Active chip).
async function createAndStartRw1(page: Page, wfName: string) {
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

// Signs an operator into the Cockpit in a FRESH context (its own cookie jar) and enters
// the work center — presence goes `online` for that WC on entry, which the chain's presence
// guard (D2) requires of the chain user.
async function openCockpit(
  browser: Browser, login: DemoLogin, wcName: string,
): Promise<{ context: BrowserContext; cockpit: Page }> {
  const context = await browser.newContext();
  const cockpit = await context.newPage();
  await cockpit.goto(COCKPIT);
  await cockpit.getByLabel('Email').fill(login.email);
  await cockpit.getByLabel('Password').fill(login.password);
  await cockpit.getByRole('button', { name: 'Sign In', exact: true }).click();
  await cockpit.getByRole('button', { name: wcName, exact: true }).click();
  return { context, cockpit };
}

test('auto-claim chain: follow-on steps chain to the claimant, stop at the child boundary, resume after it', async ({ page, browser, request }) => {
  test.setTimeout(150_000); // two operators, seven engine round trips — well past the 30 s default

  await bootstrapFirstAdmin(request);
  await signIn(page, ADMIN.email, ADMIN.password);
  await createAutoClaimWorkCenter(page, WC_NAME);
  await load(page, chainWorkflowPackage({ localId: WF_NAME, oid: 'e2e-chain-1' }));
  await assignToWorkCenter(page, WC_NAME, STEWARD.email);
  await assignToWorkCenter(page, WC_NAME, ADMIN.email);
  await restrictNodeToNewRole(page, WC_NAME, WF_NAME, 'Review', REVIEWER_ROLE, ADMIN.email);

  // Both operators must be online BEFORE the run starts: with the sole-candidate rule (spec
  // 2026-08-17 D11), starting earlier would let the arrival sweep hand "Fill Details" to
  // whichever operator enters first; a two-candidate pool keeps the first claim manual, which
  // is what this test exercises.
  const a = await openCockpit(browser, STEWARD, WC_NAME);
  const b = await openCockpit(browser, ADMIN, WC_NAME);
  const opA = a.cockpit;
  const opB = b.cockpit;
  await createAndStartRw1(page, WF_NAME);

  // 1. The first step is a normal offer (no chain memory yet): the operator claims by hand.
  const fillOffer = opA.getByRole('listitem').filter({ hasText: 'Fill Details' });
  await expect(fillOffer.getByRole('button', { name: 'Claim', exact: true })).toBeVisible({ timeout: 30_000 });
  await fillOffer.getByRole('button', { name: 'Claim', exact: true }).click();
  await expect(opA.getByLabel('Reason')).toBeVisible();
  await opA.getByLabel('Reason').fill('chain me');
  await opA.getByRole('button', { name: 'Continue', exact: true }).click();

  // 2. Across the SCRIPT step and the PARALLEL fan-out, BOTH branch steps auto-claim to the
  //    operator (D1, D3): they arrive as tabs — never as "Available" — with no Claim click.
  const tabCheckA = opA.getByRole('tab', { name: /Check A · RW-1/ });
  const tabCheckB = opA.getByRole('tab', { name: /Check B · RW-1/ });
  await expect(tabCheckA).toBeVisible({ timeout: 30_000 });
  await expect(tabCheckB).toBeVisible({ timeout: 30_000 });
  await opA.getByRole('tab', { name: /^Inbox/ }).click();
  await expect(opA.getByRole('button', { name: 'Claim', exact: true })).toHaveCount(0); // nothing merely offered
  await expect(opA.getByRole('tab')).toHaveCount(4); // Inbox + Workflows + Check A + Check B

  // Work the branches through the tab strip. (Which branch WorkView auto-focused after the
  // submit is arbitrary — both rows are inserted by one reconcile pass and share a
  // claimedAt — so the test picks tabs explicitly; auto-focus itself is asserted at step 5,
  // where the arrival is unambiguous.)
  await tabCheckA.click();
  await expect(tabCheckA).toHaveAttribute('aria-selected', 'true');
  await opA.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(tabCheckA).toHaveCount(0, { timeout: 30_000 }); // submit retires the pane at once
  await tabCheckB.click();
  await expect(tabCheckB).toHaveAttribute('aria-selected', 'true');
  await opA.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(opA.getByRole('tab')).toHaveCount(2, { timeout: 30_000 }); // nothing claimed → only the fixed Inbox/Workflows tabs remain

  // 3. Child boundary: a NEW scope has no chain memory (D6), but the reviewer is the child
  //    role's ONLY online holder — the sole-candidate rule (spec 2026-08-17 D11) claims it for
  //    B at birth: it arrives as a TAB, never as "Available", and never reaches A in any form.
  const tabReview = opB.getByRole('tab', { name: /Review Details · RW-1/ });
  await expect(tabReview).toBeVisible({ timeout: 30_000 });
  await expect(opA.getByRole('tab')).toHaveCount(2);
  await expect(opA.getByText('Review Details')).toHaveCount(0);
  await tabReview.click();
  await expect(tabReview).toHaveAttribute('aria-selected', 'true');
  await expect(opB.getByLabel('Verdict')).toBeVisible();
  await opB.getByLabel('Verdict').fill('fine');
  await opB.getByRole('button', { name: 'Continue', exact: true }).click();

  // 4. Inside the child the chain belongs to the reviewer: the second child step is a tab for
  //    B (its allowed roles are inherited from the child node — B holds the role), no claim.
  const tabApprove = opB.getByRole('tab', { name: /Approve Review · RW-1/ });
  await expect(tabApprove).toBeVisible({ timeout: 30_000 });
  await tabApprove.click();
  await expect(tabApprove).toHaveAttribute('aria-selected', 'true');
  await opB.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(opB.getByRole('tab')).toHaveCount(2, { timeout: 30_000 });

  // 5. Parent chain resumes: "Wrap Up" activates in the REVIEWER's submit transaction yet
  //    auto-claims to the line operator (parent-scope memory: their completed Check A/B). A is
  //    idle on the inbox, so WorkView focuses the arriving tab — the chain hand-off — unasked.
  const tabWrap = opA.getByRole('tab', { name: /Wrap Up · RW-1/ });
  await expect(tabWrap).toBeVisible({ timeout: 30_000 });
  await expect(tabWrap).toHaveAttribute('aria-selected', 'true');
  await opA.getByRole('button', { name: 'Continue', exact: true }).click();

  // 6. Back in CM: RW-1 ran to completion.
  await expect
    .poll(async () => cardStatusText(page), { timeout: 30_000 })
    .toContain('Completed');
  await a.context.close();
  await b.context.close();
});

test('self-release of a chained step: pane retires quietly, offer returns and is not re-stolen, chain resumes on re-claim', async ({ page, browser, request }) => {
  test.setTimeout(150_000);

  await bootstrapFirstAdmin(request);
  await signIn(page, ADMIN.email, ADMIN.password);
  await createAutoClaimWorkCenter(page, WC_NAME_2);
  await load(page, chainReleaseWorkflowPackage({ localId: WF_NAME_2, oid: 'e2e-chain-2' }));
  await assignToWorkCenter(page, WC_NAME_2, STEWARD.email);
  await createAndStartRw1(page, WF_NAME_2);

  const { context, cockpit } = await openCockpit(browser, STEWARD, WC_NAME_2);

  // RW-15 regression shape: the run starts BEFORE the operator is online, so Step One is born
  // a no-candidate offer; entering the work center fires the arrival sweep (spec 2026-08-17
  // D14b) and the sole online operator receives it as a TAB — no Claim button anywhere.
  const tabOne = cockpit.getByRole('tab', { name: /Step One · RW-1/ });
  await expect(tabOne).toBeVisible({ timeout: 30_000 });
  await expect(cockpit.getByRole('button', { name: 'Claim', exact: true })).toHaveCount(0);
  await tabOne.click();
  await expect(cockpit.getByLabel('Reason')).toBeVisible();
  await cockpit.getByLabel('Reason').fill('first');
  await cockpit.getByRole('button', { name: 'Continue', exact: true }).click();
  // The chain then hands BOTH fan-out branches over as tabs.
  const tabTwoA = cockpit.getByRole('tab', { name: /Two A · RW-1/ });
  const tabTwoB = cockpit.getByRole('tab', { name: /Two B · RW-1/ });
  await expect(tabTwoA).toBeVisible({ timeout: 30_000 });
  await expect(tabTwoB).toBeVisible({ timeout: 30_000 });

  // Release Two A from "My tasks" — the inbox stays mounted beside the panes, one tab away.
  await cockpit.getByRole('tab', { name: /^Inbox/ }).click();
  const myTwoA = cockpit.getByRole('listitem').filter({ hasText: 'Two A' });
  await expect(myTwoA.getByRole('button', { name: 'Release', exact: true })).toBeVisible();
  await myTwoA.getByRole('button', { name: 'Release', exact: true }).click();

  // Self-release retires ITS pane QUIETLY (WorkView's onReleased seam — the "No longer yours"
  // copy is reserved for claims taken by someone else): Two B's tab survives, Two A's is gone,
  // and Two A is back under "Available".
  await expect(tabTwoA).toHaveCount(0, { timeout: 30_000 });
  await expect(tabTwoB).toBeVisible();
  await expect(cockpit.getByText(/No longer yours/)).toHaveCount(0);
  const offerTwoA = cockpit.getByRole('listitem').filter({ hasText: 'Two A' })
    .getByRole('button', { name: 'Claim', exact: true });
  await expect(offerTwoA).toBeVisible({ timeout: 30_000 });

  // D5 — not re-stolen: submitting Two B runs a reconcile pass whose sole-candidate THIRD PASS
  // (spec 2026-08-17) genuinely attempts this now-open offer — the operator is still online,
  // still the scope's chain user, and with nobody else in the WC is the sole candidate — but
  // the attempt is blocked by the released_from_user_id marker (D13), so Two A must stay under
  // "Available" — no tab, no toast — after that pass has landed (its snapshot arrives over SSE
  // within the bounded window below). The release itself already swept (D14b) with the same
  // blocked outcome: this negative window is stronger proof than before, not weaker.
  await tabTwoB.click();
  await expect(tabTwoB).toHaveAttribute('aria-selected', 'true');
  await cockpit.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(cockpit.getByRole('tab')).toHaveCount(2, { timeout: 30_000 }); // Two B closed, Two A not re-claimed
  await cockpit.waitForTimeout(2_000);
  await expect(offerTwoA).toBeVisible();
  await expect(cockpit.getByRole('tab')).toHaveCount(2);
  await expect(cockpit.getByText(/No longer yours/)).toHaveCount(0);

  // Re-claim by hand: the operator claims and completes Two A, the join fires, and Step Three
  // chains — the tab appears without a claim (whoever claims and completes the next step in
  // the scope is the chain user again).
  await offerTwoA.click();
  await expect(tabTwoA).toBeVisible();
  await tabTwoA.click();
  await expect(tabTwoA).toHaveAttribute('aria-selected', 'true');
  await cockpit.getByRole('button', { name: 'Continue', exact: true }).click();
  const tabThree = cockpit.getByRole('tab', { name: /Step Three · RW-1/ });
  await expect(tabThree).toBeVisible({ timeout: 30_000 });
  await tabThree.click();
  await expect(tabThree).toHaveAttribute('aria-selected', 'true');
  await cockpit.getByRole('button', { name: 'Continue', exact: true }).click();

  await expect
    .poll(async () => cardStatusText(page), { timeout: 30_000 })
    .toContain('Completed');
  await context.close();
});

test('sole-candidate: a lone online operator claims nothing by hand — parent, fan-out, and child all auto-claim', async ({ page, browser, request }) => {
  test.setTimeout(150_000);

  await bootstrapFirstAdmin(request);
  await signIn(page, ADMIN.email, ADMIN.password);
  await createAutoClaimWorkCenter(page, WC_NAME_3);
  // Same chain fixture, but NO role restriction on the child node: the lone operator is the
  // sole candidate for every scope, so the whole run must flow with zero Claim clicks.
  await load(page, chainWorkflowPackage({ localId: WF_NAME_3, oid: 'e2e-chain-3' }));
  await assignToWorkCenter(page, WC_NAME_3, STEWARD.email);
  await createAndStartRw1(page, WF_NAME_3);          // starts with NOBODY online — the RW-15 shape

  const { context, cockpit } = await openCockpit(browser, STEWARD, WC_NAME_3);

  // Arrival sweep (D14b): Fill Details was born a no-candidate offer; entering the WC claims it.
  const tabFill = cockpit.getByRole('tab', { name: /Fill Details · RW-1/ });
  await expect(tabFill).toBeVisible({ timeout: 30_000 });
  await expect(cockpit.getByRole('button', { name: 'Claim', exact: true })).toHaveCount(0);
  await tabFill.click();
  await expect(cockpit.getByLabel('Reason')).toBeVisible();
  await cockpit.getByLabel('Reason').fill('sole');
  await cockpit.getByRole('button', { name: 'Continue', exact: true }).click();

  // Fan-out chains as before (D3): both branches arrive as tabs.
  const tabCheckA = cockpit.getByRole('tab', { name: /Check A · RW-1/ });
  const tabCheckB = cockpit.getByRole('tab', { name: /Check B · RW-1/ });
  await expect(tabCheckA).toBeVisible({ timeout: 30_000 });
  await expect(tabCheckB).toBeVisible({ timeout: 30_000 });
  await tabCheckA.click();
  await expect(tabCheckA).toHaveAttribute('aria-selected', 'true');
  await cockpit.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(tabCheckA).toHaveCount(0, { timeout: 30_000 });
  await tabCheckB.click();
  await expect(tabCheckB).toHaveAttribute('aria-selected', 'true');
  await cockpit.getByRole('button', { name: 'Continue', exact: true }).click();

  // Child boundary (D11): no chain memory in the child scope, but the lone operator is the
  // sole candidate — with one user the role boundary is moot, so it claims, not offers.
  const tabReview = cockpit.getByRole('tab', { name: /Review Details · RW-1/ });
  await expect(tabReview).toBeVisible({ timeout: 30_000 });
  await expect(cockpit.getByRole('button', { name: 'Claim', exact: true })).toHaveCount(0);
  await tabReview.click();
  await expect(tabReview).toHaveAttribute('aria-selected', 'true');
  await expect(cockpit.getByLabel('Verdict')).toBeVisible();
  await cockpit.getByLabel('Verdict').fill('fine');
  await cockpit.getByRole('button', { name: 'Continue', exact: true }).click();

  // Chain inside the child, then the parent chain resumes — all tabs, no claims.
  const tabApprove = cockpit.getByRole('tab', { name: /Approve Review · RW-1/ });
  await expect(tabApprove).toBeVisible({ timeout: 30_000 });
  await tabApprove.click();
  await expect(tabApprove).toHaveAttribute('aria-selected', 'true');
  await cockpit.getByRole('button', { name: 'Continue', exact: true }).click();
  const tabWrap = cockpit.getByRole('tab', { name: /Wrap Up · RW-1/ });
  await expect(tabWrap).toBeVisible({ timeout: 30_000 });
  await tabWrap.click();
  await expect(tabWrap).toHaveAttribute('aria-selected', 'true');
  await cockpit.getByRole('button', { name: 'Continue', exact: true }).click();

  await expect
    .poll(async () => cardStatusText(page), { timeout: 30_000 })
    .toContain('Completed');
  await context.close();
});
