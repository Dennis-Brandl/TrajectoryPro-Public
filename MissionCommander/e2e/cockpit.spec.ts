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
// Phase 4b: proves the full operator loop against the live engine + served Cockpit —
// CM creates and starts a UI workflow; the engine parks it and offers it; an operator
// claims, fills, submits, and decides it in the Cockpit PWA on :3006; the instance
// completes back in CM. Uses STEWARD as the operator: eligibility = WC membership
// (the fixture is role-unrestricted), assigned via the admin session's API cookie
// (`page.request` shares the browser context's cookie jar with `page` itself).
//
// createWorkCenter/load: copied verbatim from mission-engine.spec.ts (same not-imported
// rationale recorded there — artifacts-load.spec.ts's own versions aren't exported either).
// cardStatusText: phase 6's replacement for the old rowStatusText (Task 12).
import { test, expect, type Page } from '@playwright/test';
import { bootstrapFirstAdmin, signIn } from './helpers/auth';
import { ADMIN, STEWARD } from './helpers/db';
import { uiWorkflowPackage, type FilePayload } from './helpers/packages';

const COCKPIT = 'http://localhost:3006';
const WC_NAME = 'E2E Cockpit WC';
const WF_NAME = 'E2E Cockpit Workflow';
const WC_NAME_2 = 'E2E Cockpit WC 2';
const WF_NAME_2 = 'E2E Cockpit Workflow 2';

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

// Phase 6 (Task 12): the Runtime tab is now filter chips -> presence strip -> card grid ->
// pagination, and ALL controls (Start/etc.) live in the per-card detail dialog (D4) — see
// runtime-controls.spec.ts for the header comment on the shared flow.
//
// cardStatusText replaces the old rowStatusText: the status badge now lives on the card
// (RuntimeCard.tsx renders exactly one `span[title]`), read via the grid's own "Refresh"
// button (RuntimeTab only refetches on an explicit refresh() call — there is exactly one on
// the whole page: Radix's TabsContent unmounts inactive tabs by default, so no other tab's
// markup is ever in the DOM to collide with it while Runtime is the active tab).
async function cardStatusText(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Refresh' }).click();
  // The overlay button (D4) is empty; the badge lives in its parent card div.
  const card = page.getByRole('button', { name: 'RW-1 details' }).locator('..');
  return ((await card.locator('span[title]').first().textContent()) ?? '').trim();
}

// Assigns STEWARD to a work center via the admin session's own cookie (the assign route —
// src/server/routes/work-centers.ts — is POST /work-centers/:id/users/:userId, not PUT;
// GET /work-centers wraps its list under { nodes }, and GET /users under { users } — both
// confirmed against the route handlers, not assumed). RW-1's eligibility only needs plain
// WC membership since uiWorkflowPackage()'s YES_NO/USER_INTERACTION steps carry no
// allowed-roles restriction (mission-control-db's buildInbox admits an unrestricted offer
// to any WC member).
async function assignStewardToWorkCenter(page: Page, wcName: string) {
  const wcs = (await (await page.request.get('/api/work-centers')).json()) as {
    nodes: Array<{ id: string; name: string }>;
  };
  const wc = wcs.nodes.find((w) => w.name === wcName);
  if (!wc) throw new Error(`assignStewardToWorkCenter: work center not found: ${wcName}`);

  const users = (await (await page.request.get('/api/users')).json()) as {
    users: Array<{ id: string; email: string }>;
  };
  const steward = users.users.find((u) => u.email === STEWARD.email);
  if (!steward) throw new Error('assignStewardToWorkCenter: STEWARD user not found');

  const assign = await page.request.post(`/api/work-centers/${wc.id}/users/${steward.id}`, { data: {} });
  expect(assign.ok()).toBeTruthy();
}

test('operator completes a UI workflow through the Cockpit', async ({ page, browser, request }) => {
  await bootstrapFirstAdmin(request);
  await signIn(page, ADMIN.email, ADMIN.password);
  await createWorkCenter(page, WC_NAME);
  await load(page, uiWorkflowPackage({ localId: WF_NAME, oid: 'e2e-cockpit-1' }));
  await assignStewardToWorkCenter(page, WC_NAME);

  // Create + start RW-1 (same dialog flow as mission-engine.spec.ts).
  await page.getByRole('button', { name: `Create runtime workflow from ${WF_NAME}` }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Create and Wait', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('RW-1 created — Waiting')).toBeVisible();
  // RW-1 is 'pending' — hidden by the default Active chip. Start via the detail dialog
  // (D4: controls live there now, not on the row/card face — runtime-workflows.spec.ts /
  // mission-engine.spec.ts adapt the same flow).
  await page.getByRole('tab', { name: 'Runtime' }).click();
  await page.getByRole('button', { name: 'All' }).click();
  await page.getByRole('button', { name: 'RW-1 details' }).click();
  await page.getByRole('button', { name: 'Start RW-1' }).click();
  await page.keyboard.press('Escape'); // close the dialog; the grid keeps polling

  // ---- Operator side: fresh browser context on the Cockpit origin.
  const operator = await browser.newContext();
  const cockpit = await operator.newPage();
  await cockpit.goto(COCKPIT);
  await cockpit.getByLabel('Email').fill(STEWARD.email);
  await cockpit.getByLabel('Password').fill(STEWARD.password);
  await cockpit.getByRole('button', { name: 'Sign In', exact: true }).click();
  await cockpit.getByRole('button', { name: WC_NAME, exact: true }).click();

  // The engine parks the form step and the offer arrives over SSE.
  await expect(cockpit.getByText('Fill Details')).toBeVisible({ timeout: 30_000 });

  // Release-and-reclaim is test 2's job; go straight through here.
  await cockpit.getByRole('button', { name: 'Claim', exact: true }).click();
  await expect(cockpit.getByLabel('Reason')).toBeVisible();
  await cockpit.getByLabel('Reason').fill('looks good');
  await cockpit.getByRole('button', { name: 'Continue' }).click();

  // Next park: the YES_NO gate. `exact: true` is load-bearing since the multi-tab WorkView
  // (auto-claim phase 3): right after Claim there is a one-frame window where the inbox's
  // "My tasks" reopen button — named "Approve? <workflow> · RW-1" — is visible before the
  // new pane takes focus. A substring name binds Playwright to THAT button, which then goes
  // `hidden` with the inbox (still attached, so the click never re-resolves) and times out
  // (the 2026-08-16 baseline failure of test 2 below).
  await expect(cockpit.getByText('Approve?')).toBeVisible({ timeout: 30_000 });
  await cockpit.getByRole('button', { name: 'Claim', exact: true }).click();
  await cockpit.getByRole('button', { name: 'Approve', exact: true }).click();

  // ---- Back in CM: RW-1 ran to completion.
  await expect
    .poll(async () => cardStatusText(page), { timeout: 30_000 })
    .toContain('Completed');
  await operator.close();
});

test('release returns a claim to the pool', async ({ page, browser, request }) => {
  await bootstrapFirstAdmin(request);
  await signIn(page, ADMIN.email, ADMIN.password);
  await createWorkCenter(page, WC_NAME_2);
  await load(page, uiWorkflowPackage({ localId: WF_NAME_2, oid: 'e2e-cockpit-2' }));
  await assignStewardToWorkCenter(page, WC_NAME_2);

  await page.getByRole('button', { name: `Create runtime workflow from ${WF_NAME_2}` }).click();
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

  const operator = await browser.newContext();
  const cockpit = await operator.newPage();
  await cockpit.goto(COCKPIT);
  await cockpit.getByLabel('Email').fill(STEWARD.email);
  await cockpit.getByLabel('Password').fill(STEWARD.password);
  await cockpit.getByRole('button', { name: 'Sign In', exact: true }).click();
  await cockpit.getByRole('button', { name: WC_NAME_2, exact: true }).click();

  await expect(cockpit.getByText('Fill Details')).toBeVisible({ timeout: 30_000 });
  await cockpit.getByRole('button', { name: 'Claim', exact: true }).click();
  await expect(cockpit.getByLabel('Reason')).toBeVisible();

  // Since the multi-tab WorkView (auto-claim phase 3) the claim is a tab and the inbox stays
  // mounted beside it: the Inbox tab is the in-app way back to "My tasks" (the pre-phase-3
  // spec had to reload the Cockpit origin here because there was no such affordance).
  await cockpit.getByRole('tab', { name: /^Inbox/ }).click();

  // The claim shows under "My tasks" as a reopen button whose accessible name includes the
  // stepName, plus a separate "Release" control.
  await expect(cockpit.getByRole('button', { name: /Fill Details/ })).toBeVisible({ timeout: 30_000 });
  await cockpit.getByRole('button', { name: 'Release', exact: true }).click();

  // Self-release retires the pane (WorkView's onReleased seam): nothing claimed → only the
  // fixed Inbox/Workflows tabs remain, the claim is gone from "My tasks", and the step is
  // back under "Available" with "Claim". The refresh behind this transition is unawaited,
  // so give it real headroom.
  await expect(cockpit.getByRole('tab')).toHaveCount(2, { timeout: 30_000 });
  await expect(cockpit.getByRole('button', { name: 'Release', exact: true })).toHaveCount(0, { timeout: 30_000 });
  await expect(cockpit.getByRole('button', { name: 'Claim', exact: true })).toBeVisible({ timeout: 30_000 });

  // Claim again and complete the flow exactly as test 1 does.
  await cockpit.getByRole('button', { name: 'Claim', exact: true }).click();
  await expect(cockpit.getByLabel('Reason')).toBeVisible();
  await cockpit.getByLabel('Reason').fill('looks good');
  await cockpit.getByRole('button', { name: 'Continue' }).click();

  await expect(cockpit.getByText('Approve?')).toBeVisible({ timeout: 30_000 });
  await cockpit.getByRole('button', { name: 'Claim', exact: true }).click();
  await cockpit.getByRole('button', { name: 'Approve', exact: true }).click(); // exact: see test 1

  await expect
    .poll(async () => cardStatusText(page), { timeout: 30_000 })
    .toContain('Completed');
  await operator.close();
});
