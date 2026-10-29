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
// Repeating SCRIPT (spec 2026-10-13): a script that completes on its own third run; a commander
// force-completes one that never finishes; a Pilot operator uses Continue now from the Waiting list.
//
// createWorkCenter/load/assignStewardToWorkCenter/createAndStart: copied verbatim from
// timed-gate.spec.ts (same not-imported rationale recorded there).

import { test, expect, type Page } from '@playwright/test';
import { bootstrapFirstAdmin, signIn } from './helpers/auth';
import { ADMIN, STEWARD } from './helpers/db';
import { repeatingScriptWorkflowPackage, type FilePayload } from './helpers/packages';

const PILOT = 'http://localhost:3006';
const WC_NAME = 'E2E Repeating Script WC';

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

async function createAndStart(page: Page, wfName: string, rw: string) {
  await page.getByRole('tab', { name: 'Workflows' }).click();
  await page.getByRole('button', { name: `Create runtime workflow from ${wfName}` }).click();
  const createDialog = page.getByRole('dialog');
  await createDialog.getByRole('button', { name: 'Create and Wait', exact: true }).click();
  await expect(createDialog).toBeHidden();
  await page.getByRole('tab', { name: 'Runtime' }).click();
  await page.getByRole('button', { name: 'All' }).click();
  await page.getByRole('button', { name: `${rw} details` }).click();
  await page.getByRole('button', { name: `Start ${rw}` }).click();
}

test('repeating scripts: one finishes on its third run; a commander forces one; an operator continues one', async ({ page, browser, request }) => {
  await bootstrapFirstAdmin(request);
  await signIn(page, ADMIN.email, ADMIN.password);
  await createWorkCenter(page, WC_NAME);
  await load(page, repeatingScriptWorkflowPackage({
    localId: 'E2E Three Runs', oid: 'e2e-repeat-three', cycleSeconds: 1,
    source: 'state.n = (state.n || 0) + 1; return state.n >= 3;',
  }));
  await load(page, repeatingScriptWorkflowPackage({
    localId: 'E2E Never Done', oid: 'e2e-repeat-never', cycleSeconds: 600,
    source: 'state.n = (state.n || 0) + 1; return false;',
  }));
  await assignStewardToWorkCenter(page, WC_NAME);

  // 1. RW-1: state carries across runs in the real stack — the third run (~2 s) completes it.
  await createAndStart(page, 'E2E Three Runs', 'RW-1');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Completed', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press('Escape');

  // 2. RW-2: a commander forces a script that would never finish.
  await createAndStart(page, 'E2E Never Done', 'RW-2');
  await expect(dialog.getByRole('button', { name: 'Force complete Poll' })).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole('button', { name: 'Force complete Poll' }).click();
  await expect(dialog.getByText('Running script · checks every 600 s')).toBeVisible();
  await dialog.getByLabel('Reason for forcing Poll').fill('e2e script reason');
  await dialog.getByRole('button', { name: 'Confirm' }).click();
  await expect(dialog.getByRole('button', { name: 'Force complete Poll' })).toHaveCount(0, { timeout: 15_000 });
  await dialog.getByRole('button', { name: /Show trace/ }).click();
  await expect(dialog.getByText(/Forced complete: e2e script reason/)).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('Escape');

  // 3. RW-3: an operator continues one from the Pilot's Waiting list.
  await createAndStart(page, 'E2E Never Done', 'RW-3');
  await page.keyboard.press('Escape');
  const operator = await browser.newContext();
  const pilot = await operator.newPage();
  await pilot.goto(PILOT);
  await pilot.getByLabel('Email').fill(STEWARD.email);
  await pilot.getByLabel('Password').fill(STEWARD.password);
  await pilot.getByRole('button', { name: 'Sign In', exact: true }).click();
  await pilot.getByRole('button', { name: WC_NAME, exact: true }).click();
  await expect(pilot.getByRole('heading', { name: 'Waiting' })).toBeVisible({ timeout: 30_000 });
  await expect(pilot.getByText('Running script · checks every 600 s')).toBeVisible();
  await pilot.getByRole('button', { name: 'Continue now: Poll' }).click();
  await pilot.getByRole('button', { name: 'Confirm' }).click();
  await expect(pilot.getByText('Continued: Poll')).toBeVisible({ timeout: 15_000 });
  await expect(pilot.getByRole('heading', { name: 'Waiting' })).toHaveCount(0, { timeout: 15_000 });
  await operator.close();
});
