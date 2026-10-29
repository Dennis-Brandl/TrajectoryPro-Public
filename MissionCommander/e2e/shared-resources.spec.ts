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
// Phase 4b (work-center shared state, spec §9): the operator verbs, end to end against the REAL
// engine. Two runtime workflows of one recipe contend for the environment resource `Printer`;
// RW-1 holds it (parked at its USER_INTERACTION), RW-2 waits. The commander releases RW-1's
// hold from the Environment pane's Resources tab; the engine grants RW-2, which now holds it.
// Then (spec §12.4 item 2) the Runtime pane shows RW-2's own workflow-scoped `Lock` row beside
// the environment `Printer` row with its holder chip, and (plan delta D23) a shared value edited
// in the Runtime pane is what the Environment pane's own tab shows too.
//
// createWorkCenter/load: copied from shared-state.spec.ts (each spec file keeps its own copy).
import { test, expect, type Page } from '@playwright/test';
import { bootstrapFirstAdmin, signIn } from './helpers/auth';
import { ADMIN } from './helpers/db';
import { sharedResourceWorkflowPackage, type FilePayload } from './helpers/packages';

const WC_NAME = 'E2E Shared Resources WC';
const WF_NAME = 'E2E Shared Resources Workflow';

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

async function load(page: Page, files: FilePayload[]) {
  await page.getByRole('button', { name: /Load packages/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Packages').setInputFiles(files);
  await dialog.getByRole('button', { name: 'Load', exact: true }).click();
  await expect(page.getByText('Load results')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();
}

// Create-and-Start from the workflow's row on the WORK CENTER's Workflows tab
// (CreateRuntimeWorkflowDialog): the engine picks the queued instance up on its ~1 s loop and
// parks it at "Use Printer" holding (or waiting on) `Printer`. Two calls back to back are
// deterministic in who wins the race: engine-access.ts's acquireQueuedRuntimeWorkflows orders
// by `queued_at`, so RW-1 always starts — and so always takes `Printer` — before RW-2.
async function createAndStart(page: Page) {
  await page.getByRole('button', { name: `Create runtime workflow from ${WF_NAME}` }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Create and Start', exact: true }).click();
  await expect(dialog).toBeHidden();
}

test('a commander releases a shared hold from the Environment pane; the waiter proceeds; the Runtime pane shows both tiers and the edited shared value', async ({ page, request }) => {
  await bootstrapFirstAdmin(request);
  await signIn(page, ADMIN.email, ADMIN.password);
  await createWorkCenter(page, WC_NAME);
  await load(page, [sharedResourceWorkflowPackage({ localId: WF_NAME, oid: 'e2e-shared-res-1', envOid: 'e2e-shared-res-env' })]);

  // Two contenders. The create entry point is the per-row action on the WORK CENTER's Workflows
  // tab (runtime-workflows.spec.ts's rationale: its accessible name is an aria-label); the work
  // center is still selected after the load.
  await page.getByRole('tab', { name: 'Workflows' }).click();
  await createAndStart(page);
  await createAndStart(page);

  // Environment → Resources: RW-1 holds Printer, RW-2 waits (chip forms per spec §6.3). The
  // engine needs a moment to start both — generous timeouts on the FIRST assertion only.
  await page.getByRole('button', { name: 'Environments' }).click(); // activity rail
  await page.getByRole('button', { name: /E2E Shared Res Env v1\.0\.0/ }).click();
  await expect(page.getByRole('heading', { name: 'E2E Shared Res Env' })).toBeVisible();
  await page.getByRole('tab', { name: 'Resources' }).click();
  // Chips are matched with `exact: true` and SCOPED TO THEIR CELL, both load-bearing.
  // `exact` — the waiter's own Cancel button is named `Cancel wait ${chipLabel} on ${name}`, so
  // a substring match on the chip label resolves to two elements (strict-mode violation, seen
  // live). The cell — the Held-by and Waiting cells carry the SAME chip label for one instance
  // at different moments, so only the column says whether RW-2 is holding or queued. Column
  // order is ResourceTable.tsx's header: Name · Type · State · Held by · Waiting · Defined by ·
  // Actions (the Environment pane renders provenance and actions, so 7 cells).
  const printerRow = page.getByRole('row', { name: /^Printer / });
  const heldBy = printerRow.getByRole('cell').nth(3);
  const waiting = printerRow.getByRole('cell').nth(4);
  await expect(heldBy.getByRole('button', { name: 'RW-1 · Use Printer', exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(waiting.getByRole('button', { name: 'RW-2 · Use Printer', exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(printerRow.getByText('In use', { exact: true })).toBeVisible();

  // Release RW-1's tracked hold. The dialog click is the deliberate act (no second confirm).
  await printerRow.getByRole('button', { name: 'Release Printer' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Release “Printer”' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Release holder RW-1 · Use Printer' }).click();
  await expect(page.getByText('Released a hold on “Printer”')).toBeVisible({ timeout: 10_000 });

  // RW-2 was granted and consumed the grant on its next transition: the chip MOVED from the
  // Waiting cell to the Held-by cell — the one assertion that a bare row-wide presence check
  // could not make (the same label sits in both cells at different moments), and the reason the
  // generous timeout hangs off the Held-by assertion.
  await expect(heldBy.getByRole('button', { name: 'RW-2 · Use Printer', exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(waiting).toHaveText('—');
  await expect(printerRow.getByRole('button', { name: 'RW-1 · Use Printer', exact: true })).toHaveCount(0);
  await expect(printerRow.getByText('In use', { exact: true })).toBeVisible();

  // Cross-link into RW-2's Runtime pane (spec §12.4 item 2): its own workflow-scoped Lock row
  // AND the environment Printer row with RW-2's holder chip, each with its scope chip.
  await heldBy.getByRole('button', { name: 'RW-2 · Use Printer', exact: true }).click();
  await expect(page.getByRole('heading', { name: new RegExp(`^RW-2 ${WF_NAME}`) })).toBeVisible({ timeout: 15_000 });
  // `Lockworkflow`, no space: the Name cell is `<span>{name}</span><span>{scope}</span>`, two
  // adjacent inline elements with no whitespace text node between them, and the accessible-name
  // computation concatenates those with no separator (verified against the live DOM — the
  // Environment pane's own rows read `Printer binary exclusive use …` because that pane renders
  // no scope chip at all).
  await expect(page.getByRole('cell', { name: 'Lockworkflow', exact: true })).toBeVisible({ timeout: 15_000 });
  const runtimePrinterRow = page.getByRole('row', { name: /^Printerenvironment / });
  await expect(runtimePrinterRow.getByRole('button', { name: 'RW-2 · Use Printer', exact: true })).toBeVisible();

  // A shared value edited in the Runtime pane's shared group is a WORK-CENTER write; the running
  // instance's view shows it at once (plan delta D23), attributed to the commander.
  await page.getByRole('button', { name: 'Edit Batch.Size' }).click();
  const input = page.getByRole('textbox', { name: 'New value for Batch.Size' });
  await input.fill('7');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Updated Batch.Size')).toBeVisible({ timeout: 10_000 });
  const sizeRow = page.getByRole('row', { name: /^Size / });
  await expect(sizeRow.getByText('7', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(sizeRow.getByText(/Demo Administrator/)).toBeVisible();

  // …and the Environment pane's Value Properties tab agrees (one registry, spec U5).
  await page.getByRole('button', { name: 'Environments' }).click();
  await page.getByRole('button', { name: /E2E Shared Res Env v1\.0\.0/ }).click();
  await page.getByRole('tab', { name: 'Value Properties' }).click();
  await expect(page.getByRole('row', { name: /^Size / }).getByText('7', { exact: true })).toBeVisible({ timeout: 15_000 });
});
