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
// Phase 3 (work-center shared state, spec §6): a loaded environment spec's resources and value
// properties are visible, live, in the Environment pane's two new tabs and the Work Center's
// Shared State tab. The component suite mocks @/lib/api/*, so only this layer proves the six
// read routes and the panes agree — and that the LOAD path really materialized the registry.
import { test, expect, type Page } from '@playwright/test';
import { bootstrapFirstAdmin, signIn } from './helpers/auth';
import { ADMIN } from './helpers/db';
import { environmentPackage, type FilePayload } from './helpers/packages';

// Same helpers as artifacts-load.spec.ts (each spec file keeps its own copy — see that file).
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
}

test('a loaded environment spec shows its resources and value properties in the Work Center and Environment panes', async ({ page, request }) => {
  await bootstrapFirstAdmin(request);
  await signIn(page, ADMIN.email, ADMIN.password);
  await createWorkCenter(page, 'E2E Shared State WC');

  await load(page, [environmentPackage({
    localId: 'E2E Shared Env', oid: 'e2e-shared-1',
    resources: [
      { name: 'Printer', resource_type: 'binary exclusive use' },
      { name: 'Bays', resource_type: 'named pool', names: ['A', 'B'] },
    ],
    valueProperties: [{ name: 'Batch', entries: [{ name: 'Size', value: '5' }, { name: 'Description', value: 'Batch settings' }] }],
  })]);
  await expect(page.getByText('1 loaded, 0 replaced, 0 already present, 0 failed')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // Work Center → Shared State (the backstop view, spec §6.4). Nothing is running, so every
  // pool is at rest — the registry is viewable with nothing running (U3).
  await page.getByRole('tab', { name: 'Env Resources' }).click();
  await expect(page.getByRole('cell', { name: 'Printer', exact: true })).toBeVisible();
  await expect(page.getByText('Free', { exact: true })).toBeVisible();
  await expect(page.getByText('2 available, 0 in use')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Size', exact: true })).toBeVisible();
  await expect(page.getByText('annotation')).toBeVisible(); // the Description entry, shown but labelled

  // Environment → Resources / Value Properties (spec §6.3), with the provenance link inside the table.
  await page.getByRole('button', { name: 'Environments' }).click(); // activity rail
  await page.getByRole('button', { name: /E2E Shared Env v1\.0\.0/ }).click();
  await expect(page.getByRole('heading', { name: 'E2E Shared Env' })).toBeVisible();
  await page.getByRole('tab', { name: 'Resources' }).click();
  await expect(page.getByRole('cell', { name: 'Bays', exact: true })).toBeVisible();
  // Scoped to the table: the hierarchy tree ALSO has a button matching this name. Both rows
  // (Printer, Bays) are declared by the same spec, so the table carries one provenance
  // button per row — assert the count rather than a single match (strict mode).
  await expect(page.getByRole('table').getByRole('button', { name: 'E2E Shared Env v1.0.0 (Effective)' })).toHaveCount(2);
  await page.getByRole('tab', { name: 'Value Properties' }).click();
  await expect(page.getByRole('cell', { name: 'Size', exact: true })).toBeVisible();
  await expect(page.getByText('Batch settings')).toBeVisible();
});
