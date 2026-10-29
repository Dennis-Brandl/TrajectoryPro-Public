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
// M6 P3 e2e (spec §9): the work-center direct-load flows against the REAL server and the
// disposable e2e Postgres (see e2e/reset-db.mjs). One file; workers:1 + fullyParallel:false
// → deterministic declaration-order run over a DB reset once at server boot.
//
// This replaced artifacts-libraries.spec.ts, which exercised the retired library hierarchy
// (pull into a library, then separately link to a work center). M6 removed both steps:
// loading IS the linking step, and a work center already IS the execution set.
//
// This file is the ONLY layer that proves the renderer and the server still agree. The
// component suite mocks @/lib/api/*, so it cannot catch a contract break — it would keep
// passing against a mock of an endpoint that 404s.
import { test, expect, type Page } from '@playwright/test';
import { bootstrapFirstAdmin, signIn } from './helpers/auth';
import { ADMIN } from './helpers/db';
import { workflowPackage, environmentPackage, diagramWorkflowPackage, type FilePayload } from './helpers/packages';

// Each Playwright test runs in a fresh, isolated browser context (cookies/storage), so a
// leg signs in cleanly without any prior leg signing out.

/**
 * Create a work center and land on its detail panel. Each leg makes its own rather than
 * selecting the seeded 'Demo Line': HierarchyPane's onSaved auto-selects the new node, so
 * this needs no tree-row selector, and every leg stays independent of the others' leftovers.
 */
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

/**
 * Drive the Load dialog: pick files, optionally tick extra work centers, submit.
 * The file input is the VISIBLE labelled control (not a hidden input behind a button), so
 * setInputFiles here targets exactly what a user interacts with.
 */
async function load(page: Page, files: FilePayload[], alsoWorkCenters: string[] = []) {
  await page.getByRole('button', { name: /Load packages/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Packages').setInputFiles(files);
  for (const name of alsoWorkCenters) await dialog.getByLabel(name, { exact: true }).check();
  await dialog.getByRole('button', { name: 'Load', exact: true }).click();
  // The results dialog replaces the load dialog.
  await expect(page.getByText('Load results')).toBeVisible({ timeout: 20_000 });
}

const closeResults = (page: Page) => page.getByRole('button', { name: 'Done' }).click();

test('loads a workflow package into a work center, which then owns it in the Workflow tree', async ({ page, request }) => {
  await bootstrapFirstAdmin(request);
  await signIn(page, ADMIN.email, ADMIN.password);
  await createWorkCenter(page, 'E2E Load WC1');

  await load(page, [workflowPackage({ localId: 'E2E Bottle Fill', oid: 'e2e-load-1' })]);
  await expect(page.getByText('1 loaded, 0 replaced, 0 already present, 0 failed')).toBeVisible();
  // Scoped to the dialog: the name is ALSO in the Workflows tab behind it, because the
  // view refreshed while the dialog was open — an unscoped locator trips strict mode.
  await expect(page.getByRole('dialog').getByText('E2E Bottle Fill')).toBeVisible();
  await closeResults(page);

  // The work center's own Workflows tab lists it…
  await page.getByRole('tab', { name: 'Workflows' }).click();
  // exact: true is load-bearing: the row's action cell holds the "Roles for E2E Bottle
  // Fill" button, and accname's name-from-content rule folds that label into the <td>'s
  // own computed name — so a non-exact match resolves to BOTH cells and trips strict mode.
  await expect(page.getByRole('cell', { name: 'E2E Bottle Fill', exact: true })).toBeVisible();

  // …and the Workflow hierarchy groups it under its OWNING work center — the header is the
  // work center's name, which is the whole point of M6's regrouping.
  await page.getByRole('button', { name: 'Workflows' }).click(); // activity rail
  await expect(page.getByRole('heading', { level: 3, name: 'E2E Load WC1' })).toBeVisible();
  await expect(page.getByRole('button', { name: /E2E Bottle Fill v1\.0\.0/ })).toBeVisible();
});

test('a second identical load reports already present and creates no second entry', async ({ page, request }) => {
  await bootstrapFirstAdmin(request);
  await signIn(page, ADMIN.email, ADMIN.password);
  await createWorkCenter(page, 'E2E Load WC2');

  const pkg = workflowPackage({ localId: 'E2E Repeat', oid: 'e2e-load-2' });
  await load(page, [pkg]);
  await expect(page.getByText('1 loaded, 0 replaced, 0 already present, 0 failed')).toBeVisible();
  await closeResults(page);

  await load(page, [pkg]);
  // The no-op rule (spec D3): same (work center, oid, version, state) is already present,
  // never a second row.
  await expect(page.getByText('0 loaded, 0 replaced, 1 already present, 0 failed')).toBeVisible();
  await closeResults(page);

  await page.getByRole('button', { name: 'Workflows' }).click();
  await expect(page.getByRole('button', { name: /E2E Repeat v1\.0\.0/ })).toHaveCount(1);
});

test('one package fanned out to two work centers becomes two independent entries', async ({ page, request }) => {
  await bootstrapFirstAdmin(request);
  await signIn(page, ADMIN.email, ADMIN.password);

  // Two work centers: the fan-out target is created first, then the one we load FROM
  // (created second so it is the auto-selected detail panel).
  await createWorkCenter(page, 'E2E Fan Target');
  await createWorkCenter(page, 'E2E Fan Source');
  await load(page, [workflowPackage({ localId: 'E2E Fanout', oid: 'e2e-load-3' })], ['E2E Fan Target']);

  // One result per (file × work center) pair.
  await expect(page.getByText('2 results — 2 loaded, 0 replaced, 0 already present, 0 failed')).toBeVisible();
  await closeResults(page);

  // Two INDEPENDENT entries, one under each work-center header (spec D3).
  await page.getByRole('button', { name: 'Workflows' }).click();
  await expect(page.getByRole('button', { name: /E2E Fanout v1\.0\.0/ })).toHaveCount(2);
  await expect(page.getByRole('heading', { level: 3, name: 'E2E Fan Source' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 3, name: 'E2E Fan Target' })).toBeVisible();
});

test('a corrupt package fails only its own pair while its sibling still commits', async ({ page, request }) => {
  await bootstrapFirstAdmin(request);
  await signIn(page, ADMIN.email, ADMIN.password);
  await createWorkCenter(page, 'E2E Load WC4');

  const corrupt: FilePayload = {
    name: 'corrupt.WFmasterX', mimeType: 'application/zip', buffer: Buffer.from('not a zip at all'),
  };
  await load(page, [workflowPackage({ localId: 'E2E Good', oid: 'e2e-load-4' }), corrupt]);

  // Per-pair isolation (spec §6.2): each ingest owns its own transaction.
  await expect(page.getByText('1 loaded, 0 replaced, 0 already present, 1 failed')).toBeVisible();
  const results = page.getByRole('dialog');
  await expect(results.getByText('E2E Good')).toBeVisible();
  await expect(results.getByText('corrupt.WFmasterX')).toBeVisible();
  await closeResults(page);

  // The good one really committed.
  await page.getByRole('button', { name: 'Workflows' }).click();
  await expect(page.getByRole('button', { name: /E2E Good v1\.0\.0/ })).toBeVisible();
});

test('routes by extension: a .WFenvirX lands in the Environments hierarchy', async ({ page, request }) => {
  await bootstrapFirstAdmin(request);
  await signIn(page, ADMIN.email, ADMIN.password);
  await createWorkCenter(page, 'E2E Load WC5');

  await load(page, [environmentPackage({ localId: 'E2E Ambient', oid: 'e2e-load-5' })]);
  await expect(page.getByText('1 loaded, 0 replaced, 0 already present, 0 failed')).toBeVisible();
  await closeResults(page);

  await page.getByRole('button', { name: 'Environments' }).click(); // activity rail
  await expect(page.getByRole('heading', { level: 3, name: 'E2E Load WC5' })).toBeVisible();
  await expect(page.getByRole('button', { name: /E2E Ambient v1\.0\.0/ })).toBeVisible();
});

test('deleting a populated work center shows the impact summary, then Delete anyway removes it', async ({ page, request }) => {
  await bootstrapFirstAdmin(request);
  await signIn(page, ADMIN.email, ADMIN.password);

  // A disposable work center so this leg never destroys anything another leg relies on.
  await createWorkCenter(page, 'E2E Doomed');

  await load(page, [workflowPackage({ localId: 'E2E Doomed WF', oid: 'e2e-load-6' })]);
  await closeResults(page);

  // Open the confirm dialog, then fire the PREFLIGHT delete from inside it. The impact
  // summary only exists once that first request has come back 409 — it destroys nothing
  // and reports what a confirmed delete would (spec §8.1).
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  const deleteDialog = page.getByRole('dialog');
  await expect(deleteDialog).toBeVisible();
  await deleteDialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(deleteDialog.getByText('This work center is not empty')).toBeVisible();
  await expect(deleteDialog.getByText('1 workflows')).toBeVisible();

  await deleteDialog.getByRole('button', { name: 'Delete anyway' }).click();
  await expect(deleteDialog).toBeHidden();

  // Gone from the tree, and its artifact went with it.
  await expect(page.getByRole('button', { name: /E2E Doomed/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Workflows' }).click();
  await expect(page.getByRole('button', { name: /E2E Doomed WF/ })).toHaveCount(0);
});

test('the Diagram tab renders the loaded workflow and drills into its child', async ({ page, request }) => {
  await bootstrapFirstAdmin(request);
  await signIn(page, ADMIN.email, ADMIN.password);
  await createWorkCenter(page, 'Diagram WC');
  await load(page, [diagramWorkflowPackage()]);
  await closeResults(page);

  // Reach the workflow's own detail panel through the Workflows hierarchy.
  await page.getByRole('button', { name: 'Workflows' }).click(); // activity rail
  await page.getByRole('button', { name: /E2E Diagram Workflow/ }).click();
  await expect(page.getByRole('heading', { name: 'E2E Diagram Workflow' })).toBeVisible();

  await page.getByRole('tab', { name: 'Diagram' }).click();
  await expect(page.getByRole('tab', { name: 'Nodes' })).toHaveCount(0);

  // Root spec: all four steps, drawn from the positions the package carried.
  //
  // `exact: true` is load-bearing. Playwright's getByText does CASE-INSENSITIVE SUBSTRING
  // matching by default, and every step renders BOTH a <text> label and a <title> of
  // "<name> — <STEP TYPE>" for assistive tech — so a loose "Begin" matches twice and trips
  // strict mode. (Note this is the opposite default from testing-library's getByText in the
  // unit tests, which matches the full string.)
  await expect(page.getByText('Begin', { exact: true })).toBeVisible();
  await expect(page.getByText('Approve', { exact: true })).toBeVisible();
  await expect(page.getByText('Finish', { exact: true })).toBeVisible();

  // The proxy step resolved to the child, so it is a real control — descend, then climb.
  await page.getByRole('button', { name: 'Open Sub Assembly' }).click();
  await expect(page.getByText('Inner Check', { exact: true })).toBeVisible();
  await expect(page.getByText('Begin', { exact: true })).toHaveCount(0);

  // Scoped to the breadcrumb: the workflow TREE also holds a button whose accessible name
  // is "E2E Diagram Workflow v1.0.0", and Playwright's substring name matching would hit
  // both. The <nav aria-label="Diagram breadcrumb"> in WorkflowDiagram.tsx is what makes
  // this scoping possible.
  await page.getByRole('navigation', { name: 'Diagram breadcrumb' })
    .getByRole('button', { name: 'E2E Diagram Workflow' }).click();
  await expect(page.getByText('Begin', { exact: true })).toBeVisible();
});
