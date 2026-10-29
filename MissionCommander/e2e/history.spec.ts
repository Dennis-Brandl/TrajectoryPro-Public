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
// Phase 7 (CM history log management), Task 9: the full history round trip — the per-WC
// History tab (Task 6), the detail dialog's flat trace + gated delete (Task 7), the
// cross-work-center rail page with its work-center scope select incl. the orphans option
// (Task 8), and the admin-only Purge flow (Task 8). Uses machineWorkflowPackage()
// (mission-engine.spec.ts's own fixture: a real, live-engine-executable START -> END graph)
// so a runtime workflow settles into `runtime_history` unattended, exactly like that spec —
// the create/start/poll-to-Completed flow below is copied from its D4 detail-dialog idiom.
//
// The engine's retention sweeper only reaps a completed `workflow_instance` after its work
// center's `finished_retention_secs` window elapses (default 3600s, sweep.ts) — nowhere near
// this spec's runtime — but that instance row is disposable BY DESIGN regardless: the whole
// point of this phase is that `runtime_history` is the permanent record, independent of it.
import { test, expect, type Page } from '@playwright/test';
import { bootstrapFirstAdmin, signIn } from './helpers/auth';
import { ADMIN } from './helpers/db';
import { machineWorkflowPackage, type FilePayload } from './helpers/packages';

const WC_NAME = 'E2E History WC';
const WF_NAME = 'E2E History Workflow';

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

// Mirrors mission-engine.spec.ts's cardStatusText: the status badge lives on the RuntimeCard
// (a sibling of the empty overlay button), read via the grid's own "Refresh" (RuntimeTab only
// refetches on an explicit refresh() call).
async function cardStatusText(page: Page, rwLabel: string): Promise<string> {
  await page.getByRole('button', { name: 'Refresh' }).click();
  const card = page.getByRole('button', { name: `${rwLabel} details` }).locator('..');
  return ((await card.locator('span[title]').first().textContent()) ?? '').trim();
}

// Phase-6 dialog flow (Workflows tab -> Create dialog -> Runtime tab -> All chip -> detail
// dialog -> Start), then poll straight to Completed: a trivial START->END machine workflow
// settles inside ONE atomic transaction (instance.ts), so 'running'/"Started" is never
// externally observable here, same as mission-engine.spec.ts.
async function createAndRunToCompletion(page: Page, rwLabel: string) {
  await page.getByRole('tab', { name: 'Workflows' }).click();
  await page.getByRole('button', { name: `Create runtime workflow from ${WF_NAME}` }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Create and Wait', exact: true }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole('tab', { name: 'Runtime' }).click();
  await page.getByRole('button', { name: 'All' }).click();
  await page.getByRole('button', { name: `${rwLabel} details` }).click();
  await page.getByRole('button', { name: `Start ${rwLabel}` }).click();
  await page.keyboard.press('Escape'); // close the dialog; the grid keeps polling

  await expect.poll(async () => cardStatusText(page, rwLabel), { timeout: 30_000 }).toBe('Completed');
}

test('history round trip: per-WC tab, detail trace, cross-WC rail page, admin purge', async ({ page, request }) => {
  await bootstrapFirstAdmin(request);
  await signIn(page, ADMIN.email, ADMIN.password);
  await createWorkCenter(page, WC_NAME);
  // machine-only executable package: START -> END, no UI steps, no starting parameters —
  // its two steps' local_ids ('Begin' / 'Finish') are the REAL step names asserted below.
  await load(page, machineWorkflowPackage({ localId: WF_NAME, oid: 'e2e-history-1' }));

  // RW-1: create, start, run to completion.
  await createAndRunToCompletion(page, 'RW-1');

  // Per-WC History tab: the completed row appears with a Completed badge.
  await page.getByRole('tab', { name: 'History' }).click();
  const row1 = page.getByRole('button', { name: 'History RW-1' });
  await expect(row1).toBeVisible();
  expect(((await row1.locator('span[title]').first().textContent()) ?? '').trim()).toBe('Completed');

  // Open the detail dialog: at least one trace entry names a REAL step ('Begin', the START
  // step's local_id from the fixture) rather than its raw oid.
  await row1.click();
  const detailDialog = page.getByRole('dialog');
  await expect(detailDialog).toBeVisible();
  await expect(detailDialog.getByRole('listitem').filter({ hasText: 'Begin' }).first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(detailDialog).toBeHidden();

  // Cross-WC rail page: the row is visible once scoped to this work center, and the
  // orphans option exists (a deleted work center's history is otherwise unreachable here).
  await page.getByRole('button', { name: 'History', exact: true }).click(); // ActivityRail
  await page.getByRole('combobox', { name: 'Work center' }).click();
  await expect(page.getByRole('option', { name: '(deleted work centers)' })).toBeVisible();
  await page.getByRole('option', { name: WC_NAME, exact: true }).click();
  await expect(page.getByRole('button', { name: 'History RW-1' })).toBeVisible();

  // Back on the work center's own History tab (selectedWorkCenterId survives the rail
  // round trip — WorkCenterDetail remounts straight to it): delete RW-1's history entry.
  await page.getByRole('button', { name: 'Work Centers', exact: true }).click(); // ActivityRail
  await page.getByRole('tab', { name: 'History' }).click();
  await row1.click();
  await expect(detailDialog).toBeVisible();
  await detailDialog.getByRole('button', { name: 'Delete' }).click();
  await detailDialog.getByRole('button', { name: 'Confirm' }).click();
  await expect(detailDialog).toBeHidden();

  // Poll-race lesson (mission-engine.spec.ts): the dialog's onDeleted callback races the
  // toast/close sequence, so force a refresh rather than trust the immediate re-render.
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(row1).toHaveCount(0);

  // RW-2: create, start, run to completion, in the SAME work center.
  await createAndRunToCompletion(page, 'RW-2');
  await page.getByRole('tab', { name: 'History' }).click();
  await expect(page.getByRole('button', { name: 'History RW-2' })).toBeVisible();

  // Admin purge: older-than = tomorrow, scoped to this work center -> preview shows 1
  // (RW-2 only; RW-1's history entry was already hard-deleted above).
  await page.getByRole('button', { name: 'History', exact: true }).click(); // ActivityRail
  await page.getByRole('combobox', { name: 'Work center' }).click();
  await page.getByRole('option', { name: WC_NAME, exact: true }).click();
  await expect(page.getByRole('button', { name: 'History RW-2' })).toBeVisible();

  await page.getByRole('button', { name: 'Purge…' }).click();
  const purgeDialog = page.getByRole('dialog');
  await expect(purgeDialog).toBeVisible();
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const localValue = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}T${pad(tomorrow.getHours())}:${pad(tomorrow.getMinutes())}`;
  await purgeDialog.getByLabel('Older than').fill(localValue);
  await purgeDialog.getByRole('combobox', { name: 'Work center scope' }).click();
  await page.getByRole('option', { name: WC_NAME, exact: true }).click();
  await expect(purgeDialog.getByText('1 history entry matches')).toBeVisible();

  await purgeDialog.getByRole('button', { name: /delete.*permanently/i }).click();
  await expect(page.getByText('1 history entry deleted')).toBeVisible(); // toast
  await expect(purgeDialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'History RW-2' })).toHaveCount(0);
});
