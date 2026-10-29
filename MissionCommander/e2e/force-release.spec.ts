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
// Phase 6: commander force-release round trip — Cockpit operator claims; CM commander
// force-releases from the detail dialog; the CM dialog immediately shows the step back
// to Offered (force-release button gone); the operator's Cockpit reacts LIVE.
//
// Auto-claim phase 3 rewrote the operator side of this spec: useInbox now lives in App, so
// the SSE snapshot the force-release triggers (engine internal.ts pg_notify + hub notify)
// reaches the operator while they are still on the task pane. WorkView's snapshot-diff
// effect sees a claim vanish WITHOUT a local close, toasts `No longer yours: <step>`,
// unmounts the pane (it is derived from the live myClaims list), and hands focus back to
// the inbox — where the step is already re-offered under "Available". That is exactly the
// "force-release blindness" the WorkView was built to fix, so this spec asserts it directly
// instead of the pre-phase-3 workaround (submitting the stale claim to provoke a 409).
//
// createWorkCenter/load/assignStewardToWorkCenter: copied verbatim from cockpit.spec.ts
// (same not-imported rationale recorded there).
import { test, expect, type Page } from '@playwright/test';
import { bootstrapFirstAdmin, signIn } from './helpers/auth';
import { ADMIN, STEWARD } from './helpers/db';
import { uiWorkflowPackage, type FilePayload } from './helpers/packages';

const COCKPIT = 'http://localhost:3006';
const WC_NAME = 'E2E Force Release WC';
const WF_NAME = 'E2E Force Release Workflow';

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

// Assigns STEWARD to a work center via the admin session's own cookie — see
// cockpit.spec.ts for the route-shape rationale (POST, not PUT; response envelopes).
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

test('commander force-releases a claimed task back to the pool', async ({ page, browser, request }) => {
  await bootstrapFirstAdmin(request);
  await signIn(page, ADMIN.email, ADMIN.password);
  await createWorkCenter(page, WC_NAME);
  await load(page, uiWorkflowPackage({ localId: WF_NAME, oid: 'e2e-force-release-1' }));
  await assignStewardToWorkCenter(page, WC_NAME);

  await page.getByRole('button', { name: `Create runtime workflow from ${WF_NAME}` }).click();
  const createDialog = page.getByRole('dialog');
  await createDialog.getByRole('button', { name: 'Create and Wait', exact: true }).click();
  await expect(createDialog).toBeHidden();
  await page.getByRole('tab', { name: 'Runtime' }).click();
  await page.getByRole('button', { name: 'All' }).click();
  await page.getByRole('button', { name: 'RW-1 details' }).click();
  await page.getByRole('button', { name: 'Start RW-1' }).click();
  await page.keyboard.press('Escape'); // close the dialog; the grid keeps polling

  // Operator claims in the Cockpit but does not submit yet.
  const operator = await browser.newContext();
  const cockpit = await operator.newPage();
  await cockpit.goto(COCKPIT);
  await cockpit.getByLabel('Email').fill(STEWARD.email);
  await cockpit.getByLabel('Password').fill(STEWARD.password);
  await cockpit.getByRole('button', { name: 'Sign In', exact: true }).click();
  await cockpit.getByRole('button', { name: WC_NAME, exact: true }).click();
  await expect(cockpit.getByText('Fill Details')).toBeVisible({ timeout: 30_000 });
  await cockpit.getByRole('button', { name: 'Claim', exact: true }).click();
  // Claimed: the operator is on the task screen now, form visible.
  await expect(cockpit.getByLabel('Reason')).toBeVisible();

  // Commander reopens RW-1's details and force-releases the claim (RuntimeDetailDialog.tsx:
  // the button's accessible name is `Force release ${stepName}`, i.e. "Force release Fill
  // Details" here — the regex is unambiguous since only one step is ever claimed at once).
  await page.getByRole('button', { name: 'RW-1 details' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: /Force release/ })).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole('button', { name: /Force release/ }).click();
  await expect(dialog.getByText(/Release the claim/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Confirm' }).click();

  // Operator side, first — the toast auto-dismisses after 5 s, so read it before the CM
  // assertions below spend their own budget. The pane is UNMOUNTED (myClaims no longer lists
  // it — assert the form control count, not visibility), the tab strip is gone (nothing
  // claimed), and the step is back under "Available" with "Claim".
  await expect(cockpit.getByText('No longer yours: Fill Details')).toBeVisible({ timeout: 15_000 });
  await expect(cockpit.getByLabel('Reason')).toHaveCount(0);
  // The claim tab is gone. The strip itself no longer collapses at zero claims: the
  // Workflows tab feature (2026-08-19 spec) made Inbox + Workflows fixed tabs, so the
  // old toHaveCount(0) has been unsatisfiable since — assert the CLAIM tab specifically.
  await expect(cockpit.getByRole('tab', { name: /Fill Details/ })).toHaveCount(0);
  await expect(cockpit.getByRole('tab')).toHaveCount(2);
  await expect(cockpit.getByRole('button', { name: 'Claim', exact: true })).toBeVisible({ timeout: 30_000 });

  // The CM dialog no longer offers force-release for it (its own 2 s poll — or the
  // explicit refresh() the successful action triggers — picks up the cleared claim).
  await expect(dialog.getByRole('button', { name: /Force release/ })).toHaveCount(0, { timeout: 15_000 });

  await operator.close();
});
