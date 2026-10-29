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
// CM Runtime pane (spec 2026-08-27 §4, Phase 1): rail section → WC tree with active
// leaves → detail pane with the live diagram → pause/resume → commander ASSIGN to an
// offline steward (presence shown, not required — the override is the point) → the
// steward's Cockpit shows the pre-claimed task under "My tasks" → force-release from
// the pane. Create-and-Start (U6) is exercised as the instance's birth path.
//
// createWorkCenter/load/assignStewardToWorkCenter: copied verbatim from
// force-release.spec.ts (same not-imported rationale recorded there).
import { test, expect, type Page } from '@playwright/test';
import { bootstrapFirstAdmin, signIn } from './helpers/auth';
import { ADMIN, STEWARD } from './helpers/db';
import { uiWorkflowPackage, type FilePayload } from './helpers/packages';

const COCKPIT = 'http://localhost:3006';
const WC_NAME = 'E2E Runtime Pane WC';
const WF_NAME = 'E2E Runtime Pane Workflow';

async function createWorkCenter(page: Page, name: string) {
  await page.getByRole('button', { name: 'Work Centers' }).click(); // activity rail
  await page.getByRole('button', { name: 'New work center' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

async function load(page: Page, file: FilePayload) {
  await page.getByRole('button', { name: /Load packages/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Packages').setInputFiles([file]);
  await dialog.getByRole('button', { name: 'Load', exact: true }).click();
  await expect(page.getByText('Load results')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();
}

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

test('runtime pane: tree → live diagram → pause/resume → assign → cockpit → revoke', async ({ page, browser, request }) => {
  await bootstrapFirstAdmin(request);
  await signIn(page, ADMIN.email, ADMIN.password);
  await createWorkCenter(page, WC_NAME);
  await load(page, uiWorkflowPackage({ localId: WF_NAME, oid: 'e2e-runtime-pane-1' }));
  await assignStewardToWorkCenter(page, WC_NAME);

  // U6: birth the instance through Create and Start — no separate Start RW-n dance.
  await page.getByRole('button', { name: `Create runtime workflow from ${WF_NAME}` }).click();
  const createDialog = page.getByRole('dialog');
  await createDialog.getByRole('button', { name: 'Create and Start', exact: true }).click();
  await expect(createDialog).toBeHidden();

  // The new rail section: tree shows the WC with the active leaf; select it.
  await page.getByRole('button', { name: 'Runtime', exact: true }).click();
  await expect(page.getByText(WC_NAME)).toBeVisible();
  const leaf = page.getByRole('button', { name: new RegExp(`RW-1 · ${WF_NAME}`) });
  await expect(leaf).toBeVisible({ timeout: 30_000 }); // engine picks the queued row up
  await leaf.click();

  // Detail pane: header + live diagram; the UI step goes WAITING_USER as the engine runs.
  const heading = page.getByRole('heading', { name: `RW-1 ${WF_NAME}` });
  await expect(heading).toBeVisible();
  await expect(page.locator('[data-step-oid]').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-state="WAITING_USER"]').first()).toBeVisible({ timeout: 30_000 });

  // The status badge appears twice at once (tree leaf + detail header — both panes are
  // mounted side by side), so getByTitle('paused')/('running') is ambiguous; scope to the
  // header's own row (the flex div wrapping the h1, version, and RuntimeStatusBadge).
  const header = heading.locator('..');

  // Pause → Paused badge (2 s pane poll + engine control pass), then Resume.
  await page.getByRole('button', { name: 'Pause RW-1', exact: true }).click();
  await expect(header.getByTitle('paused')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Resume RW-1', exact: true }).click();
  await expect(header.getByTitle('running')).toBeVisible({ timeout: 15_000 });

  // Assign the offered step to the (offline) steward — presence shown, never required.
  await page.getByRole('button', { name: 'Assign Fill Details', exact: true }).click();
  const assignDialog = page.getByRole('dialog');
  await expect(assignDialog.getByRole('heading', { name: /Assign/ })).toBeVisible();
  await assignDialog.getByRole('button', { name: /Steward/ }).click();
  await expect(page.getByText(/Assigned/)).toBeVisible({ timeout: 15_000 });
  // The claims panel flips to the revoke affordance once the 2 s poll lands the claim.
  await expect(page.getByRole('button', { name: 'Force release Fill Details', exact: true })).toBeVisible({ timeout: 15_000 });

  // The steward's Cockpit opens onto the pre-claimed task: WorkView's auto-focus-on-arrival
  // effect (see WorkView.tsx's "Live-list reactions") only fires for a pane that appears
  // BETWEEN two live snapshots — the operator's very first snapshot already contains this
  // claim (assigned before their session began), so it lands on the Inbox tab same as
  // cockpit.spec.ts's "reopen an existing claim" leg: the claim shows under "My tasks" as a
  // button whose accessible name includes the step name; open it explicitly.
  const operator = await browser.newContext();
  const cockpit = await operator.newPage();
  await cockpit.goto(COCKPIT);
  await cockpit.getByLabel('Email').fill(STEWARD.email);
  await cockpit.getByLabel('Password').fill(STEWARD.password);
  await cockpit.getByRole('button', { name: 'Sign In', exact: true }).click();
  await cockpit.getByRole('button', { name: WC_NAME, exact: true }).click();
  await expect(cockpit.getByRole('button', { name: /Fill Details/ })).toBeVisible({ timeout: 30_000 });
  await cockpit.getByRole('button', { name: /Fill Details/ }).click();
  await expect(cockpit.getByLabel('Reason')).toBeVisible({ timeout: 30_000 });

  // Revoke from the pane: the steward loses the task live.
  await page.getByRole('button', { name: 'Force release Fill Details', exact: true }).click();
  await expect(page.getByText(/Release the claim/)).toBeVisible();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(cockpit.getByText('No longer yours: Fill Details')).toBeVisible({ timeout: 15_000 });
  await expect(cockpit.getByLabel('Reason')).toHaveCount(0);

  await operator.close();
});
