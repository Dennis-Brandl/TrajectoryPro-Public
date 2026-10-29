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
// Runtime workflow ID format (spec 2026-10-07), Task 12: a work center's own
// {YYYY}{MM}{DD}/{SEQ} template is honoured end to end — set it in the Edit dialog, see
// it render live in the preview, and see the SAME server-computed label on the Runtime
// tab's card and, once the run completes, in the per-WC History tab.
//
// createWorkCenter/load: copied verbatim from mission-engine.spec.ts / history.spec.ts
// (same not-exported rationale recorded there — artifacts-load.spec.ts's own local
// versions aren't exported either). Every other click below is inlined rather than
// calling a shared helper: neither openWorkCenterEdit nor createRuntimeWorkflow exists
// anywhere in this directory as an IMPORTABLE helper — cockpit-esignature.spec.ts does
// define a local createRuntimeWorkflow, but it hardcodes the toast/label text to
// literal 'RW-1', which is wrong for a work center carrying a custom format.
//
// Selectors below (the 'Runtime ID format' label, the 'runtime-id-preview' testid, the
// 'Edit work center' dialog title, its 'Save' submit button) were verified directly
// against WorkCenterDialog.tsx and WorkCenterDetail.tsx on 2026-10-08, not assumed from
// the task brief's own summary of them.
//
// Uses machineWorkflowPackage() (mission-engine.spec.ts's own fixture: a real, live-
// engine-executable START -> END graph, no starting parameters) so the runtime workflow
// actually reaches 'completed' and lands a permanent row in runtime_history
// (history.spec.ts's own reason for the same choice) — the whole point of this spec is
// to see the configured label survive from creation through to that permanent record.
//
// Deliberately does NOT assert against the separate cross-WC Runtime-rail tree
// (RuntimeWorkflowTree.tsx, reached via ActivityRail's 'Runtime' entry, distinct from
// this work center's own 'Runtime' TAB): that tree only lists instances in
// RUNTIME_ACTIVE_STATUSES ('queued'/'running'/...), and a trivial START->END workflow
// settles that whole window inside ONE atomic acquire+start transaction — mission-
// engine.spec.ts's and runtime-workflows.spec.ts's own documented caveat is that
// 'running'/"Started" is "never externally observable here". Asserting on that leaf
// would be a coin flip, not a test. RuntimeWorkflowTree.tsx already reads
// rw.runtimeLabel directly (confirmed 2026-10-08, same as every other display site
// Tasks 9+10 touched) and is covered at the unit level by RuntimeWorkflowTree.test.tsx.
//
// NOT YET RUN: this spec has never been executed. Author-verified against source only —
// see the Task 12 report for why (the user's fleet was live on this machine).
import { test, expect, type Page } from '@playwright/test';
import { bootstrapFirstAdmin, signIn } from './helpers/auth';
import { ADMIN } from './helpers/db';
import { machineWorkflowPackage, type FilePayload } from './helpers/packages';

const WC_NAME = 'E2E Runtime ID WC';
const WF_NAME = 'E2E Runtime ID Workflow';
const FORMAT = 'E2E-{YYYY}{MM}{DD}-{SEQ:3}';

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

// Mirrors mission-engine.spec.ts / history.spec.ts's own cardStatusText, parametrized on
// the computed label rather than a hardcoded 'RW-1' — this work center's configured
// format never renders that string.
async function cardStatusText(page: Page, rwLabel: string): Promise<string> {
  await page.getByRole('button', { name: 'Refresh' }).click();
  // The overlay button (D4) is empty; the badge lives in its parent card div.
  const card = page.getByRole('button', { name: `${rwLabel} details` }).locator('..');
  return ((await card.locator('span[title]').first().textContent()) ?? '').trim();
}

test('a configured work-center format shows on the run and in history', async ({ page, request }) => {
  await bootstrapFirstAdmin(request);
  await signIn(page, ADMIN.email, ADMIN.password);
  await createWorkCenter(page, WC_NAME);
  // Machine-only executable package: START -> END, no UI steps, no starting parameters —
  // needed so the live engine (playwright.config.ts's third webServer entry) can run it
  // to Completed unattended, the same way mission-engine.spec.ts and history.spec.ts do.
  await load(page, machineWorkflowPackage({ localId: WF_NAME, oid: 'e2e-runtime-id-1' }));

  // WorkCenterDetail's header "Edit" button (always visible above the Tabs, independent
  // of which tab is active) opens WorkCenterDialog in edit mode: initial !== null, so its
  // DialogTitle reads 'Edit work center' and its submit button reads 'Save' (WorkCenterDialog.tsx).
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Edit work center' })).toBeVisible();
  await dialog.getByLabel('Runtime ID format').fill(FORMAT);
  await expect(dialog.getByTestId('runtime-id-preview')).toContainText('E2E-');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();

  // allocateRuntimeIdentity (mission-control-db/src/dao/work-centers.ts) buckets on
  // getRuntimeIdTimezone's default — Intl.DateTimeFormat().resolvedOptions().timeZone of
  // the SERVER process, running on this same machine — which matches both this test's own
  // Node-local date and the dialog preview's own browser-local-timezone computation.
  const today = new Date();
  const ymd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  const RW1 = `E2E-${ymd}-001`;

  await page.getByRole('tab', { name: 'Workflows' }).click();
  await page.getByRole('button', { name: `Create runtime workflow from ${WF_NAME}` }).click();
  const createDialog = page.getByRole('dialog');
  await expect(createDialog).toBeVisible();
  await expect(createDialog.getByRole('heading', { name: 'Create Runtime Workflow' })).toBeVisible();
  // No starting parameters declared — the no-params branch (CreateRuntimeWorkflowDialog.tsx).
  await expect(createDialog.getByText('This workflow declares no starting parameters.')).toBeVisible();
  await createDialog.getByRole('button', { name: 'Create and Wait', exact: true }).click();
  await expect(createDialog).toBeHidden();
  // The toast reads the server-computed rw.runtimeLabel straight (CreateRuntimeWorkflowDialog.tsx) —
  // proves the configured format, not the built-in RW-n default, drove this creation.
  await expect(page.getByText(`${RW1} created — Waiting`)).toBeVisible();

  // Runtime tab (Task 9: RuntimeCard/RuntimeDetailDialog read rw.runtimeLabel) — "the run".
  await page.getByRole('tab', { name: 'Runtime' }).click();
  await page.getByRole('button', { name: 'All' }).click(); // RW1 is 'pending' — hidden by the default Active chip
  await expect(page.getByRole('button', { name: `${RW1} details` })).toBeVisible();
  expect(await cardStatusText(page, RW1)).toBe('Waiting');

  // Start via the detail dialog (D4: controls live there, not on the card face).
  await page.getByRole('button', { name: `${RW1} details` }).click();
  await page.getByRole('button', { name: `Start ${RW1}` }).click();
  await page.keyboard.press('Escape'); // close the dialog; the grid keeps polling

  // A trivial START->END machine workflow settles inside ONE atomic acquire+start
  // transaction (instance.ts), so 'running'/"Started" is never externally observable
  // here — only 'completed'/"Completed" is (mission-engine.spec.ts's own documented
  // behaviour for the identical fixture).
  await expect.poll(async () => cardStatusText(page, RW1), { timeout: 30_000 }).toBe('Completed');

  // Per-WC History tab (Task 10: HistoryTable reads row.runtimeLabel; its row carries
  // aria-label `History ${row.runtimeLabel}`) — "the history".
  await page.getByRole('tab', { name: 'History' }).click();
  const historyRow = page.getByRole('button', { name: `History ${RW1}` });
  await expect(historyRow).toBeVisible();
  expect(((await historyRow.locator('span[title]').first().textContent()) ?? '').trim()).toBe('Completed');
});
