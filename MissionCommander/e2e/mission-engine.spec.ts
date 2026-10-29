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
// Task 20: proves the containerized-in-spirit Mission Engine (playwright.config.ts's
// third webServer entry — `npm --prefix ../MissionEngine run start`, against
// the SAME e2e Postgres as entry 1) actually executes a runtime workflow, end to end,
// rather than just leaving it queued forever the way every OTHER e2e spec's runtime
// workflows do (they use helpers/packages.ts's plain workflowPackage(), which is not
// machine-executable — see machineWorkflowPackage()'s own doc comment).
//
// Mirrors runtime-workflows.spec.ts's structure (local createWorkCenter/load helpers,
// same reason they're not imported: artifacts-load.spec.ts's own versions aren't
// exported either).
import { test, expect, type Page } from '@playwright/test';
import { bootstrapFirstAdmin, signIn } from './helpers/auth';
import { ADMIN } from './helpers/db';
import { machineWorkflowPackage, type FilePayload } from './helpers/packages';

const WC_NAME = 'E2E Engine WC';
const WF_NAME = 'E2E Engine Workflow';

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
// pagination, and ALL controls (Start/Delete/etc.) live in the per-card detail dialog (D4) —
// see runtime-controls.spec.ts for the header comment on the shared flow. RuntimeTab resets
// to its default 'active' filter chip every time it remounts (Radix's TabsContent unmounts
// inactive tabs by default, so switching away from and back to the Runtime tab is a fresh
// mount) — the 'All' chip must be re-clicked on every visit that needs to see a 'pending' row.
//
// cardStatusText replaces the old rowStatusText: the status badge now lives on the card
// (RuntimeCard.tsx renders exactly one `span[title]`), read via the grid's own "Refresh"
// button (RuntimeTab only refetches on an explicit refresh() call) — so the dialog must be
// closed (Escape) before calling this, or the Refresh button underneath a modal dialog isn't
// reachable.
async function cardStatusText(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Refresh' }).click();
  // The overlay button (D4) is empty; the badge lives in its parent card div.
  const card = page.getByRole('button', { name: 'RW-1 details' }).locator('..');
  return ((await card.locator('span[title]').first().textContent()) ?? '').trim();
}

test('the Mission Engine executes a runtime workflow end to end', async ({ page, request }) => {
  await bootstrapFirstAdmin(request);
  await signIn(page, ADMIN.email, ADMIN.password);
  await createWorkCenter(page, WC_NAME);
  // machine-only executable package: START -> END, no UI steps, no starting parameters.
  await load(page, machineWorkflowPackage({ localId: WF_NAME, oid: 'e2e-engine-1' }));

  await page.getByRole('tab', { name: 'Runtime' }).click();
  await expect(page.getByText('No runtime workflows')).toBeVisible();

  await page.getByRole('tab', { name: 'Workflows' }).click();
  await page.getByRole('button', { name: `Create runtime workflow from ${WF_NAME}` }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Create Runtime Workflow' })).toBeVisible();
  // No starting parameters declared — the no-params branch (CreateRuntimeWorkflowDialog.tsx).
  await expect(dialog.getByText('This workflow declares no starting parameters.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Create and Wait', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('RW-1 created — Waiting')).toBeVisible();

  // RW-1 is 'pending' — hidden by the default Active chip.
  await page.getByRole('tab', { name: 'Runtime' }).click();
  await page.getByRole('button', { name: 'All' }).click();
  await expect(page.getByRole('button', { name: 'RW-1 details' })).toBeVisible();
  expect(await cardStatusText(page)).toBe('Waiting');

  // Start via the detail dialog (D4: controls live there now).
  await page.getByRole('button', { name: 'RW-1 details' }).click();
  await page.getByRole('button', { name: 'Start RW-1' }).click();
  await page.keyboard.press('Escape'); // close the dialog; the grid keeps polling

  // The live engine picks this up off the queue and runs it — a trivial START->END
  // workflow settles inside ONE atomic acquire+start transaction (instance.ts), so
  // 'running'/"Started" is never externally observable here; poll straight through to
  // 'completed'/"Completed".
  await expect.poll(async () => cardStatusText(page), { timeout: 30_000 }).toBe('Completed');

  // Retention window (Task 17): the completed card is still visible, and 'completed' is
  // in RUNTIME_DELETABLE (runtime-status.ts), so Delete is enabled in the dialog.
  await expect(page.getByRole('button', { name: 'RW-1 details' })).toBeVisible();
  await page.getByRole('button', { name: 'RW-1 details' }).click();
  await expect(page.getByRole('button', { name: 'Delete RW-1' })).toBeEnabled();

  await page.getByRole('button', { name: 'Delete RW-1' }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  // The dialog's delete path closes without refreshing the grid — force a refresh
  // (matching cardStatusText's own pattern) instead of racing the 5s poll tick.
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByRole('button', { name: 'RW-1 details' })).toHaveCount(0);
});
