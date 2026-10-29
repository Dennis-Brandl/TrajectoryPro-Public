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
// Golden-path e2e for the Mission Commander renderer (Task 14, Plan 3). Drives the REAL
// server (playwright.config.ts's webServer) against a REAL, disposable e2e Postgres —
// see e2e/reset-db.mjs. AUTHORED + TYPECHECKED here; the run itself is DEFERRED in
// environments with no reachable Postgres (mirrors Plan 2 Task 13's smoke deferral) —
// see .superpowers/sdd/task-14-report.md for the deferral record.
//
// Both specs live in this one file (not split across files) so `workers: 1` +
// `fullyParallel: false` gives them a deterministic, declaration-order run within a
// single worker — the admin test always runs before the viewer test — but the viewer
// test is still written defensively (see its own comments) rather than relying on
// that ordering for correctness.
import { test, expect } from '@playwright/test';
import { bootstrapFirstAdmin, signIn } from './helpers/auth';
import { ADMIN, VIEWER } from './helpers/db';

const ROOT_NAME = 'E2E Root WC';
const CHILD_NAME = 'E2E Child WC';

test('admin can create a child WC, link a workflow, then unlink and delete', async ({ page, request }) => {
  await bootstrapFirstAdmin(request); // POST sign-up/email → first admin (gate-tolerant; see helpers/auth.ts)
  await signIn(page, ADMIN.email, ADMIN.password);

  // Only one WorkCenterDialog/DeleteWorkCenterDialog/LinkPickerModal is ever mounted
  // (Radix unmounts on close) at any point in this flow, so a single unscoped locator
  // always refers to "whichever one is currently open" — reused below across four
  // separate open/close cycles rather than re-deriving it each time.
  const dialog = page.getByRole('dialog');

  // --- Create a root work center via the tree header ＋ (WorkCenterTree.tsx). ---
  await page.getByRole('button', { name: 'New work center' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Name').fill(ROOT_NAME);
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toBeHidden();

  // HierarchyPane's onSaved selects the new node — "select it" is automatic here.
  await expect(page.getByRole('heading', { name: ROOT_NAME })).toBeVisible();

  // --- Create a child from the tree row's ＋ ("New child of {name}", WorkCenterTree.tsx). ---
  // This is the only child-creation control: the detail panel's duplicate "New Child" button
  // was removed 2026-09-09 (user feedback — two controls for one action was confusing).
  await page.getByRole('button', { name: `New child of ${ROOT_NAME}` }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Name').fill(CHILD_NAME);
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toBeHidden();

  // WorkCenterDetail's own onSaved selects the new child the same way.
  await expect(page.getByRole('heading', { name: CHILD_NAME })).toBeVisible();

  // --- Workflows tab: M6 removed the link picker entirely. An artifact reaches a work
  // center by being LOADED into it (see artifacts-load.spec.ts), so a fresh child work
  // center simply owns nothing, and there is no link affordance to exercise here. ---
  await page.getByRole('tab', { name: 'Workflows' }).click();
  await expect(page.getByText('No workflows loaded')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Link workflow', exact: true })).toHaveCount(0);

  // --- Delete the child (Delete → confirm). ---
  // Unscoped here is safe: the confirm dialog isn't mounted yet, so this is currently
  // the only "Delete"-named button on the page.
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(dialog).toBeVisible();
  // Scoped: once the confirm dialog is open, WorkCenterDetail's own "Delete" trigger is
  // still present behind it, so an unscoped lookup would match two elements.
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(dialog).toBeHidden();

  // Assert selection cleared (DetailPanel's placeholder) and the tree updated (the
  // child's tree row — a plain button whose accessible name is just its name — is gone).
  await expect(page.getByText('Select a work center')).toBeVisible();
  await expect(page.getByRole('button', { name: CHILD_NAME, exact: true })).toHaveCount(0);
});

test('a viewer sees the tool read-only', async ({ page }) => {
  await signIn(page, VIEWER.email, VIEWER.password);

  // The tree header ＋ is disabled purely by capability, independent of whether any
  // work center exists yet — assert this unconditionally.
  const newWorkCenterButton = page.getByRole('button', { name: 'New work center' });
  await expect(newWorkCenterButton).toBeDisabled();
  await expect(newWorkCenterButton).toHaveAttribute('title', 'Requires work_center:create');

  // Detail-level controls (Edit/Delete/Load) only render once a work center
  // is selected. seedDemoFixture guarantees 'Demo Line' exists in every reset e2e
  // database, so the tree always has at least one row (possibly more, e.g. the admin
  // spec's own root work center left behind above) — select whichever renders first.
  const firstTreeItem = page.getByRole('treeitem').first();
  await expect(firstTreeItem).toBeVisible();
  // The row's own select button carries no aria-label (only its chevron and "New
  // child of X" siblings do); target it structurally — direct child of the row's
  // wrapper div, lacking aria-label — rather than by name, since this spec doesn't
  // know (and must not assume) which work center, if any, exists.
  await firstTreeItem.locator(':scope > div > button:not([aria-label])').first().click();

  const edit = page.getByRole('button', { name: 'Edit' });
  await expect(edit).toBeVisible();
  await expect(edit).toBeDisabled();
  await expect(edit).toHaveAttribute('title', 'Requires work_center:edit');

  // Child creation lives only on the tree row's ＋ ("New child of {name}") since 2026-09-09;
  // it gates on the same right the removed detail-panel button did.
  const newChild = firstTreeItem.getByRole('button', { name: /^New child of / });
  await expect(newChild).toBeDisabled();
  await expect(newChild).toHaveAttribute('title', 'Requires work_center:create');

  const del = page.getByRole('button', { name: 'Delete', exact: true });
  await expect(del).toBeDisabled();
  await expect(del).toHaveAttribute('title', 'Requires work_center:delete');

  // M6 replaced the artifact link picker with the Load control, gated on workflow:create.
  const loadPackages = page.getByRole('button', { name: /Load packages/ });
  await expect(loadPackages).toBeDisabled();
  await expect(loadPackages).toHaveAttribute('title', 'Requires workflow:create');

  await page.getByRole('tab', { name: 'Workflows' }).click();
  await expect(page.getByRole('button', { name: 'Link workflow', exact: true })).toHaveCount(0);
});
