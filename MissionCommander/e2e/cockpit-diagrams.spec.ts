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
// Cockpit Workflows tab (spec 2026-08-19): CM starts a UI workflow; the operator
// opens the Workflows tab, sees the live diagram color the parked USER_INTERACTION
// step as waiting+mine, jumps to the inbox via the tooltip's Open, claims, submits,
// and watches the step turn COMPLETED on the next 2s poll. Diagram nodes are located
// by data-step-name (instance oids are rt_N, unknowable here).
//
// createWorkCenter/load/assignStewardToWorkCenter: copied verbatim from
// cockpit.spec.ts (same not-imported rationale recorded there).
import { test, expect, type Page } from '@playwright/test';
import { bootstrapFirstAdmin, signIn } from './helpers/auth';
import { ADMIN, STEWARD } from './helpers/db';
import { uiWorkflowPackage, type FilePayload } from './helpers/packages';

const COCKPIT = 'http://localhost:3006';
const WC_NAME = 'E2E Diagram Tab WC';
const WF_NAME = 'E2E Diagram Tab Workflow';

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

test('the Workflows tab shows a live diagram that follows the run', async ({ page, browser, request }) => {
  await bootstrapFirstAdmin(request);
  await signIn(page, ADMIN.email, ADMIN.password);
  await createWorkCenter(page, WC_NAME);
  await load(page, uiWorkflowPackage({ localId: WF_NAME, oid: 'e2e-dgtab-1' }));
  await assignStewardToWorkCenter(page, WC_NAME);

  await page.getByRole('button', { name: `Create runtime workflow from ${WF_NAME}` }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Create and Wait', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('tab', { name: 'Runtime' }).click();
  await page.getByRole('button', { name: 'All' }).click();
  await page.getByRole('button', { name: 'RW-1 details' }).click();
  await page.getByRole('button', { name: 'Start RW-1' }).click();
  await page.keyboard.press('Escape');

  const operator = await browser.newContext();
  const cockpit = await operator.newPage();
  await cockpit.goto(COCKPIT);
  await cockpit.getByLabel('Email').fill(STEWARD.email);
  await cockpit.getByLabel('Password').fill(STEWARD.password);
  await cockpit.getByRole('button', { name: 'Sign In', exact: true }).click();
  await cockpit.getByRole('button', { name: WC_NAME, exact: true }).click();

  // The fixed tab exists even with nothing claimed; the chip appears once the engine parks.
  await cockpit.getByRole('tab', { name: /^Workflows/ }).click();
  await expect(cockpit.getByRole('option', { name: /RW-1 · / })).toBeVisible({ timeout: 30_000 });

  // Diagram: Fill Details parks as waiting and is offered to this operator (mine ring).
  const fill = cockpit.locator('g[data-step-name="Fill Details"]');
  await expect(fill).toHaveAttribute('data-state', 'WAITING_USER', { timeout: 30_000 });
  await expect(fill).toHaveAttribute('data-mine', 'true');

  // Tooltip → Open → lands on the inbox (offered, not claimed).
  await fill.click();
  await expect(cockpit.getByText('Offered to you')).toBeVisible();
  await cockpit.getByRole('button', { name: 'Open' }).click();
  await expect(cockpit.getByRole('heading', { name: 'My tasks' })).toBeVisible();

  // Claim + submit the form step (exact:true — the load-bearing lesson from cockpit.spec.ts).
  await cockpit.getByRole('button', { name: 'Claim', exact: true }).click();
  await expect(cockpit.getByLabel('Reason')).toBeVisible();
  await cockpit.getByLabel('Reason').fill('diagram e2e');
  await cockpit.getByRole('button', { name: 'Continue' }).click();

  // Wait out the submit BEFORE switching tabs: WorkView's closePane fires when the
  // async submit resolves and unconditionally refocuses (next pane, else inbox) — a
  // Workflows click raced against it gets undone, the tab goes inactive, and the
  // focus-gated poll freezes on the pre-submit state. Pane retired = 2 fixed tabs.
  await expect(cockpit.getByRole('tab')).toHaveCount(2, { timeout: 30_000 });

  // Back on Workflows: the form step completes and the YES_NO gate parks, on the 2s poll.
  await cockpit.getByRole('tab', { name: /^Workflows/ }).click();
  await expect(fill).toHaveAttribute('data-state', 'COMPLETED', { timeout: 30_000 });
  await expect(cockpit.locator('g[data-step-name="Approve?"]')).toHaveAttribute('data-state', 'WAITING_USER', { timeout: 30_000 });

  await operator.close();
});
