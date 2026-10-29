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
// Phase 6: the full control loop through the detail dialog — pause -> resume -> stop —
// asserting the status badge transitions the engine actually performs. Setup copied from
// cockpit.spec.ts's admin side (same not-imported-helpers rationale recorded there).
import { test, expect, type Page } from '@playwright/test';
import { bootstrapFirstAdmin, signIn } from './helpers/auth';
import { ADMIN } from './helpers/db';
import { uiWorkflowPackage, type FilePayload } from './helpers/packages';

const WC_NAME = 'E2E Controls WC';
const WF_NAME = 'E2E Controls Workflow';

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

async function dialogStatus(page: Page): Promise<string> {
  // The dialog polls every 2 s; the title badge carries title=<status>.
  const badge = page.getByRole('dialog').locator('span[title]').first();
  return ((await badge.textContent()) ?? '').trim();
}

test('pause -> resume -> stop from the detail dialog', async ({ page, request }) => {
  await bootstrapFirstAdmin(request);
  await signIn(page, ADMIN.email, ADMIN.password);
  await createWorkCenter(page, WC_NAME);
  await load(page, uiWorkflowPackage({ localId: WF_NAME, oid: 'e2e-controls-1' }));

  await page.getByRole('button', { name: `Create runtime workflow from ${WF_NAME}` }).click();
  const createDialog = page.getByRole('dialog');
  await createDialog.getByRole('button', { name: 'Create and Wait', exact: true }).click();
  await expect(createDialog).toBeHidden();

  await page.getByRole('tab', { name: 'Runtime' }).click();
  await page.getByRole('button', { name: 'All' }).click();
  await page.getByRole('button', { name: 'RW-1 details' }).click();
  await page.getByRole('button', { name: 'Start RW-1' }).click();

  // Engine picks it up; the parked UI step holds status at running ("Started").
  await expect(async () => expect(await dialogStatus(page)).toBe('Started')).toPass({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Pause RW-1' }).click(); // no confirm (D4)
  await expect(async () => expect(await dialogStatus(page)).toBe('Paused')).toPass({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Resume RW-1' }).click();
  await expect(async () => expect(await dialogStatus(page)).toBe('Started')).toPass({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Request stop RW-1' }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  // Stop cancels the parked WAITING_USER step and settles (phase-3 semantics; the
  // stop-over-proxy-child fix covers nested variants).
  await expect(async () => expect(await dialogStatus(page)).toBe('Stopped')).toPass({ timeout: 30_000 });
});
