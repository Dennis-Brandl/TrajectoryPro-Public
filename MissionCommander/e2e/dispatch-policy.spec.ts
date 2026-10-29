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
// Phase 4a (spec 2026-08-03 §6, Task 13): the dispatch-policy control on WorkflowDetail's
// Overview tab, driven against the REAL server and the disposable e2e Postgres (see
// e2e/reset-db.mjs) — same harness as every other spec in this directory. createWorkCenter/
// load below reproduce artifacts-load.spec.ts's own local helpers (not exported there, so
// not importable).
//
// The point of this leg is persistence across a hard reload: WorkflowDetail's dispatch-policy
// value comes from the server (workflowView -> workflow.dispatchPolicy), not from any
// client-side store, and the selection itself (useSelectionStore) is NOT persisted across a
// reload — so this reselects the workflow after each reload rather than expecting the SPA to
// restore its own navigation state.
//
// NOTE: this spec is WRITTEN here per Task 13's brief but is not run in this task — the full
// `npm run e2e` run happens in Task 14, with the e2e environment (disposable Postgres, both
// webServer entries) properly prepared.
import { test, expect, type Page } from '@playwright/test';
import { bootstrapFirstAdmin, signIn } from './helpers/auth';
import { ADMIN } from './helpers/db';
import { workflowPackage } from './helpers/packages';

const WC_NAME = 'E2E Dispatch WC';
const WF_NAME = 'E2E Dispatch Workflow';

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

async function load(page: Page, name: string, oid: string) {
  await page.getByRole('button', { name: /Load packages/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Packages').setInputFiles([workflowPackage({ localId: name, oid })]);
  await dialog.getByRole('button', { name: 'Load', exact: true }).click();
  await expect(page.getByText('Load results')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();
}

// Enters the Workflow hierarchy (activity rail) and opens WF_NAME's detail panel. Used both
// for the initial navigation and to reselect after each hard reload, since
// useSelectionStore carries no persistence of its own.
async function openWorkflow(page: Page) {
  await page.getByRole('button', { name: 'Workflows' }).click(); // activity rail
  await page.getByRole('button', { name: `${WF_NAME} v1.0.0` }).click();
  await expect(page.getByRole('heading', { name: WF_NAME })).toBeVisible();
}

test('a dispatch-policy override survives a reload, and so does clearing it back to inherit', async ({ page, request }) => {
  await bootstrapFirstAdmin(request);
  await signIn(page, ADMIN.email, ADMIN.password);
  await createWorkCenter(page, WC_NAME);
  await load(page, WF_NAME, 'e2e-dispatch-1');

  await openWorkflow(page);
  const select = page.getByRole('combobox', { name: 'Dispatch policy' });
  await expect(select).toHaveText('Inherit work-center default');
  await expect(page.getByText('Suggests tasks to operators; any eligible operator may claim')).toBeVisible();

  // Set an override.
  await select.click();
  await page.getByRole('option', { name: 'Manual (pull only)' }).click();
  await expect(page.getByText('Dispatch policy saved')).toBeVisible();
  await expect(select).toHaveText('Manual (pull only)');

  // Reload drops the client-side selection entirely (no persisted route/store) — reselect,
  // then confirm the override actually came back from the server, not from local state.
  await page.reload();
  await openWorkflow(page);
  await expect(page.getByRole('combobox', { name: 'Dispatch policy' })).toHaveText('Manual (pull only)');

  // Clear it back to inherit.
  await page.getByRole('combobox', { name: 'Dispatch policy' }).click();
  await page.getByRole('option', { name: 'Inherit work-center default' }).click();
  await expect(page.getByText('Dispatch policy saved')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Dispatch policy' })).toHaveText('Inherit work-center default');

  await page.reload();
  await openWorkflow(page);
  await expect(page.getByRole('combobox', { name: 'Dispatch policy' })).toHaveText('Inherit work-center default');
});
