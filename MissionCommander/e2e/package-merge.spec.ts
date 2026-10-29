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
// Drives P3's merge mode through a real browser against the real server. The renderer unit
// suite mocks @/lib/api/* wholesale and src/lib/api/types.ts declares its own copy of the
// server's ImportReport shape (mirrored "field for field" but nothing links the two
// declarations structurally — see that file's comment), so a renderer<->server contract
// break on the merge route passes BOTH `npm test` and `tsc`. Only this spec proves the
// browser and the server still agree on what a merge preview and a merge apply look like.
//
// Modelled on package-round-trip.spec.ts (export/import round trip), reusing its dialog
// conventions: only one Radix dialog is ever mounted at a time (it unmounts on close), so an
// unscoped `page.getByRole('dialog')` always refers to whichever one is currently open.
import { test, expect } from '@playwright/test';
import { bootstrapFirstAdmin, signIn } from './helpers/auth';
import { ADMIN } from './helpers/db';
import { workflowPackage } from './helpers/packages';

test('a steward previews and confirms a package merge into an existing work center, keeping what the package does not touch', async ({ page, context, request }) => {
  await bootstrapFirstAdmin(request);
  await signIn(page, ADMIN.email, ADMIN.password);

  const dialog = page.getByRole('dialog');

  // 1. Source work center with real content and a distinctive Description. The description
  // is what triggers a D10 work-center-level config overwrite on merge (spec §8.5.2) — it is
  // never null on either side, so the preview's "from -> to" text stays legible instead of
  // rendering the literal string "null".
  await page.getByRole('button', { name: 'New work center' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Name').fill('Merge Source');
  await dialog.getByLabel('Description').fill('Source config note');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Merge Source' })).toBeVisible();

  await page.getByRole('button', { name: /Load packages/ }).click();
  await expect(dialog).toBeVisible();
  const payload = workflowPackage({ localId: 'Merge Payload Workflow', oid: 'e2e-merge-payload-wf' });
  await dialog.getByLabel('Packages').setInputFiles({ name: payload.name, mimeType: payload.mimeType, buffer: payload.buffer });
  await dialog.getByRole('button', { name: 'Load', exact: true }).click();
  await expect(page.getByText('Load results')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();

  // 2. Export it (SavePackageDialog). Wait for the preview summary before touching Download —
  // the anchor only renders once the preview promise resolves.
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

  // 3. A second, DIFFERENT work center to merge into. Its own Description (so the merge has
  // something real to overwrite) and its own workflow entry that the package does NOT
  // contain — that entry surviving the merge untouched is the additive rule (spec §8.5.1),
  // and it is what D9's provenance/target-only proof rides on later.
  await page.getByRole('button', { name: 'New work center' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Name').fill('Merge Target');
  await dialog.getByLabel('Description').fill('Target local note');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Merge Target' })).toBeVisible();

  await page.getByRole('button', { name: /Load packages/ }).click();
  await expect(dialog).toBeVisible();
  const targetOnly = workflowPackage({ localId: 'Merge Target Only Workflow', oid: 'e2e-merge-target-only-wf' });
  await dialog.getByLabel('Packages').setInputFiles({ name: targetOnly.name, mimeType: targetOnly.mimeType, buffer: targetOnly.buffer });
  await dialog.getByRole('button', { name: 'Load', exact: true }).click();
  await expect(page.getByText('Load results')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('cell', { name: 'Merge Target Only Workflow', exact: true })).toBeVisible();

  // 4. Import the exported package via the tree toolbar's Import package control, choose
  // merge, target "Merge Target", and preview. `exact: true` throughout this leg is load-
  // bearing, not decoration: "Merge Target" is a substring of "New child of Merge Target"
  // (the row's own child-create button) and "Merge" is a substring of the mode button's own
  // label "Merge into existing work center" — either collision would trip Playwright's
  // strict-mode "resolved to N elements" failure rather than silently pass.
  await page.getByRole('button', { name: 'Import package' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Package').setInputFiles(packagePath!);
  await dialog.getByRole('button', { name: 'Merge into existing work center' }).click();
  await dialog.getByLabel('Target work center').click();
  await page.getByRole('option', { name: 'Merge Target', exact: true }).click();
  await dialog.getByRole('button', { name: 'Preview merge' }).click();

  // The preview names the exact D10 overwrite it would make on confirm.
  await expect(dialog.getByText('This merge would')).toBeVisible();
  await expect(dialog.getByText('Config changes')).toBeVisible();
  await expect(dialog.getByText(/Target local note/)).toBeVisible();
  await expect(dialog.getByText(/Source config note/)).toBeVisible();

  // 5. The strongest assertion in this spec: the preview above has written NOTHING to the
  // database. Proving that from THIS tab would be weak — WorkCenterDetail only refetches on
  // an id change or an explicit refresh(), and neither previewMerge nor a mere dialog click
  // triggers either, so the underlying pane would read "unchanged" even if the preview HAD
  // written, simply because nobody asked the server again. A second tab in the SAME signed-in
  // context, doing its own fresh navigation and its own fresh fetch, has no such blind spot.
  // The first tab's dialog is left open and untouched throughout — its `impact` state is what
  // step 6 confirms against.
  const verifyPage = await context.newPage();
  await verifyPage.goto('/');
  await verifyPage.getByRole('button', { name: 'Merge Target', exact: true }).click();
  await expect(verifyPage.getByRole('heading', { name: 'Merge Target' })).toBeVisible();
  await expect(verifyPage.getByRole('cell', { name: 'Merge Target Only Workflow', exact: true })).toBeVisible();
  await expect(verifyPage.getByText('Merge Payload Workflow')).toHaveCount(0);
  await verifyPage.getByRole('button', { name: 'Edit' }).click();
  const verifyDialog = verifyPage.getByRole('dialog');
  await expect(verifyDialog).toBeVisible();
  await expect(verifyDialog.getByLabel('Description')).toHaveValue('Target local note');
  await verifyDialog.getByRole('button', { name: 'Cancel' }).click();
  await verifyPage.close();

  // 6. Back on the first tab: confirm the merge for real.
  await dialog.getByRole('button', { name: 'Merge', exact: true }).click();
  await expect(dialog.getByText('Merge applied')).toBeVisible();
  await expect(dialog.getByText(/1 matched/)).toBeVisible();
  await expect(dialog.getByText(/1 workflows/i)).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();

  // 7. The merged result, through the UI, on a fresh fetch (same id-change trick as step 5,
  // this time on the ORIGINAL tab): the newly-merged workflow and the pre-existing
  // target-only one are BOTH present (additive), and the target's own Description now
  // carries the package's value (D10 applied for real this time, not rolled back).
  await page.getByRole('button', { name: 'Merge Source', exact: true }).click();
  await page.getByRole('button', { name: 'Merge Target', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Merge Target' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Merge Payload Workflow', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Merge Target Only Workflow', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit' }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Description')).toHaveValue('Source config note');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
});
