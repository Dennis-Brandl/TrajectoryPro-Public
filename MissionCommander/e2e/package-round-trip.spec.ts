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
// Export and import driven against each other through real HTTP. The unit round-trip in
// package/import.test.ts runs both halves in-process; only this proves the renderer and the
// server still agree, because the component suite mocks @/lib/api/* and types.ts declares
// its own shapes — a contract break passes both vitest and tsc.
import { test, expect } from '@playwright/test';
import { bootstrapFirstAdmin, signIn } from './helpers/auth';
import { ADMIN } from './helpers/db';
import { sampleWorkflowPackage } from './helpers/packages';

test('a steward exports a work center and imports the package back as a new one', async ({ page, request }) => {
  await bootstrapFirstAdmin(request);
  await signIn(page, ADMIN.email, ADMIN.password);

  // Only one dialog is ever mounted (Radix unmounts on close) at any point in this flow —
  // WorkCenterDialog, then LoadDialog, then its LoadResultsDialog, then SavePackageDialog,
  // then WorkCenterDialog again (Edit), then ImportPackageDialog — so a single unscoped
  // locator always refers to whichever one is currently open (same convention as
  // package-save.spec.ts / golden-path.spec.ts).
  const dialog = page.getByRole('dialog');

  // 1. Build a work center with real content, via the tree header's ＋ (WorkCenterTree.tsx).
  // The default activeHierarchy is 'work_center' (selectionStore.ts), so it is already the
  // landing pane after sign-in — no activity-rail click needed.
  await page.getByRole('button', { name: 'New work center' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Name').fill('RT Source');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toBeHidden();
  // HierarchyPane's onSaved already selects the new node (selectWorkCenter(v.workCenter.id)) —
  // no extra click needed, and none is safe here: the tree's own row for "RT Source" and this
  // heading are BOTH on screen at once, so an unscoped getByText('RT Source') would resolve to
  // two elements and trip strict mode. Scope to the heading, as golden-path.spec.ts does.
  await expect(page.getByRole('heading', { name: 'RT Source' })).toBeVisible();

  await page.getByRole('button', { name: /Load packages/ }).click();
  await expect(dialog).toBeVisible();
  const pkg = sampleWorkflowPackage();
  await dialog.getByLabel('Packages').setInputFiles({ name: pkg.name, mimeType: pkg.mimeType, buffer: pkg.buffer });
  await dialog.getByRole('button', { name: 'Load', exact: true }).click();
  // The results dialog replaces the load dialog.
  await expect(page.getByText('Load results')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();

  // 2. Export it (SavePackageDialog). Wait for the preview summary before touching Download —
  // the anchor only renders once the preview promise resolves (see SavePackageDialog.tsx);
  // clicking role=link too early would find nothing yet.
  await page.getByRole('button', { name: 'Save package…' }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/1 workflows/i)).toBeVisible();

  const downloadPromise = page.waitForEvent('download'); // registered BEFORE the click
  await page.getByRole('link', { name: 'Download' }).click();
  const download = await downloadPromise;
  const packagePath = await download.path();
  expect(packagePath).toBeTruthy();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();

  // 3. Rename the source so the import's new root does not collide with it. WorkCenterDialog's
  // submit label is 'Save' in edit mode ({isEdit ? 'Save' : 'Create'} — WorkCenterDialog.tsx),
  // distinct from the create-mode 'Create' used above.
  await page.getByRole('button', { name: 'Edit' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Name').fill('RT Original');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  // Scoped to the heading for the same strict-mode reason as step 1: the rename lands on
  // both the detail heading (setView, synchronous) and the tree row (refreshTree, async), so
  // an unscoped getByText('RT Original') can resolve to two elements once both catch up.
  await expect(page.getByRole('heading', { name: 'RT Original' })).toBeVisible();

  // 4. Import the very bytes that were downloaded, via the tree toolbar's Import package
  // control (aria-label="Import package" — WorkCenterTree.tsx). Task 8 made the dialog
  // mode-first (ImportPackageDialog.tsx): once a file is picked, mode starts out null and
  // the Import button only renders once "Create new work center" is chosen — so that choice
  // has to happen here before Import is clickable.
  await page.getByRole('button', { name: 'Import package' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Package').setInputFiles(packagePath!);
  await dialog.getByRole('button', { name: 'Create new work center' }).click();
  await dialog.getByRole('button', { name: 'Import' }).click();

  await expect(dialog.getByText(/1 work centers/i)).toBeVisible();
  await expect(dialog.getByText(/1 workflows/i)).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();

  // 5. The imported work center is a real, navigable row — not merely a 200 response. Its
  // import is not auto-selected (unlike create), so "RT Source" now names exactly the new
  // tree row — the old work center answers to "RT Original" since step 3 — and this text
  // query is unambiguous.
  await expect(page.getByText('RT Source')).toBeVisible();
  await page.getByText('RT Source').click();
  await expect(page.getByRole('heading', { name: 'RT Source' })).toBeVisible();
  // Workflows is WorkCenterDetail's default tab (Tabs defaultValue="workflows"), so the
  // loaded workflow is visible with no extra tab click.
  await expect(page.getByText('E2E Sample Workflow')).toBeVisible();
});
