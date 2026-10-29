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
// Draft reload e2e (spec 2026-10-18): re-loading a CHANGED Draft package at the same
// (work center, oid, version, state) replaces the loaded copy instead of reporting
// "already present", and the Load results dialog says so with a `replaced` pill.
import AdmZip from 'adm-zip';
import { test, expect, type Page } from '@playwright/test';
import { bootstrapFirstAdmin, signIn } from './helpers/auth';
import { ADMIN } from './helpers/db';
import type { FilePayload } from './helpers/packages';

/** A Draft workflow with one named middle step. Same oid + version + state across builds. */
function draftPackage(stepName: string): FilePayload {
  const oid = 'e2e-draft-reload-1';
  const root = {
    local_id: 'E2E Draft Reload', oid, version: '1.0.0', state: 'Draft', schemaVersion: '5.0',
    steps: [
      { local_id: 'Begin', oid: `${oid}-s0`, step_type: 'START', position: { x: 0, y: 100 } },
      { local_id: stepName, oid: `${oid}-s1`, step_type: 'USER_INTERACTION', position: { x: 200, y: 90 } },
      { local_id: 'Finish', oid: `${oid}-s2`, step_type: 'END', position: { x: 400, y: 100 } },
    ],
    connections: [
      { from_step_id: `${oid}-s0`, to_step_id: `${oid}-s1` },
      { from_step_id: `${oid}-s1`, to_step_id: `${oid}-s2` },
    ],
    children: [],
  };
  const zip = new AdmZip();
  zip.addFile(`${root.local_id}.WFmaster`, Buffer.from(JSON.stringify(root), 'utf8'));
  return { name: `${oid}-v1.0.0.WFmasterX`, mimeType: 'application/zip', buffer: zip.toBuffer() };
}

async function createWorkCenter(page: Page, name: string) {
  await page.getByRole('button', { name: 'Work Centers' }).click();
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

test('re-loading a changed Draft workflow replaces it', async ({ page, request }) => {
  await bootstrapFirstAdmin(request);
  await signIn(page, ADMIN.email, ADMIN.password);
  await createWorkCenter(page, 'E2E Draft Reload WC');

  await load(page, [draftPackage('Old Step')]);
  await expect(page.getByText('1 loaded, 0 replaced, 0 already present, 0 failed')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // Same oid, version and state; one step renamed.
  await load(page, [draftPackage('Renamed Step')]);
  await expect(page.getByRole('dialog').getByText('replaced', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // Still ONE entry in the work center's list.
  await page.getByRole('tab', { name: 'Workflows' }).click();
  await expect(page.getByRole('cell', { name: 'E2E Draft Reload', exact: true })).toHaveCount(1);

  // Its detail shows the renamed step, not the old one.
  await page.getByRole('button', { name: 'Workflows' }).click(); // activity rail
  await expect(page.getByRole('button', { name: /E2E Draft Reload v1\.0\.0/ })).toHaveCount(1);
  await page.getByRole('button', { name: /E2E Draft Reload v1\.0\.0/ }).click();
  await page.getByRole('tab', { name: 'Diagram' }).click();
  await expect(page.getByText('Renamed Step', { exact: true })).toBeVisible();
  await expect(page.getByText('Old Step', { exact: true })).toHaveCount(0);
});
