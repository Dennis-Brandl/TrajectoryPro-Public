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
// ISA 88 type names (spec 2026-10-19): a work center type and a workflow type show in the
// hierarchy rows and on the detail pages, and clearing the work center type removes the suffix.
import { test, expect } from '@playwright/test';
import { bootstrapFirstAdmin, signIn } from './helpers/auth';
import { ADMIN } from './helpers/db';
import { workflowPackage } from './helpers/packages';

test('a work center type and a workflow type show in the hierarchy and on the detail pages', async ({ page, request }) => {
  await bootstrapFirstAdmin(request);
  await signIn(page, ADMIN.email, ADMIN.password);
  const dialog = page.getByRole('dialog');

  // 1. Create a work center with a type.
  await page.getByRole('button', { name: 'New work center' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Name').fill('E2E Line');
  await dialog.getByLabel('Type').fill('Production Line');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toBeHidden();

  // 2. Tree row and detail page.
  await expect(page.getByRole('heading', { name: 'E2E Line' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'E2E Line · Production Line' })).toBeVisible();
  await expect(page.getByText('Type: Production Line')).toBeVisible();

  // 3. Load a typed workflow into it.
  await page.getByRole('button', { name: /Load packages/ }).click();
  await expect(dialog).toBeVisible();
  const pkg = workflowPackage({ localId: 'E2E Clean Tank', oid: 'e2e-isa88-wf', typeName: 'Operation' });
  await dialog.getByLabel('Packages').setInputFiles({ name: pkg.name, mimeType: pkg.mimeType, buffer: pkg.buffer });
  await dialog.getByRole('button', { name: 'Load', exact: true }).click();
  await expect(page.getByText('Load results')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();

  // 4. Work center tree leaf, Workflows hierarchy row, workflow detail.
  // The row is expanded but its workflow leaves are fetched lazily on a fresh expand, so
  // collapse and re-expand to pull the just-loaded workflow (WorkCenterTree.toggle).
  await page.getByRole('button', { name: 'Collapse E2E Line' }).click();
  await page.getByRole('button', { name: 'Expand E2E Line' }).click();
  await expect(page.getByRole('tree').getByText('E2E Clean Tank · Operation')).toBeVisible();
  await page.getByRole('button', { name: 'Workflows' }).click(); // activity rail
  const row = page.getByRole('button', { name: 'E2E Clean Tank v1.0.0 · Operation' });
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.getByRole('heading', { name: 'E2E Clean Tank' })).toBeVisible();
  await expect(page.getByText('Type: Operation')).toBeVisible();

  // 5. Clearing the work center type removes the suffix.
  await page.getByRole('button', { name: 'Work Centers' }).click(); // activity rail
  await page.getByRole('button', { name: 'E2E Line · Production Line' }).click();
  await page.getByRole('button', { name: 'Edit' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Type').fill('');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'E2E Line', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /E2E Line ·/ })).toHaveCount(0);
});
