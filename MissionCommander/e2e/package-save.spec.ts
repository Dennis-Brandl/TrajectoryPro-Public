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
// P1's own e2e gate (Task 9, spec §14): the renderer suite mocks @/lib/api/* and
// src/lib/api/types.ts declares its own shapes independently of the server, so a
// renderer↔server contract break on the new package endpoints would pass both vitest and
// tsc. This is the only layer that drives the real Save package… dialog against the real
// Hono server and reads the resulting .WFcenterX archive back with a real zip reader,
// proving the download really is what the UI claims it is.
import { test, expect } from '@playwright/test';
import AdmZip from 'adm-zip';
import { bootstrapFirstAdmin, signIn } from './helpers/auth';
import { ADMIN } from './helpers/db';
import { sampleWorkflowPackage } from './helpers/packages';

const WC_NAME = 'E2E Package Line';

test('a steward saves a work center as a .WFcenterX and the archive contains what was loaded', async ({ page, request }) => {
  await bootstrapFirstAdmin(request);
  await signIn(page, ADMIN.email, ADMIN.password);

  // Only one dialog is ever mounted (Radix unmounts on close) at any point in this flow —
  // WorkCenterDialog, then LoadDialog, then its LoadResultsDialog, then SavePackageDialog,
  // each closed before the next opens — so a single unscoped locator always refers to
  // whichever one is currently open (same convention as golden-path.spec.ts).
  const dialog = page.getByRole('dialog');

  // --- Create a work center to save, via the tree header's ＋ (WorkCenterTree.tsx). The
  // default activeHierarchy is 'work_center', so it is already the landing pane after
  // sign-in — no activity-rail click needed (mirrors golden-path.spec.ts). ---
  await page.getByRole('button', { name: 'New work center' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Name').fill(WC_NAME);
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toBeHidden();
  // HierarchyPane's onSaved selects the new node.
  await expect(page.getByRole('heading', { name: WC_NAME })).toBeVisible();

  // --- Load one real workflow package into it, so the export has content (WorkCenterDetail
  // → LoadDialog). ---
  await page.getByRole('button', { name: /Load packages/ }).click();
  await expect(dialog).toBeVisible();
  const pkg = sampleWorkflowPackage();
  await dialog.getByLabel('Packages').setInputFiles({ name: pkg.name, mimeType: pkg.mimeType, buffer: pkg.buffer });
  await dialog.getByRole('button', { name: 'Load', exact: true }).click();
  // The results dialog replaces the load dialog.
  await expect(page.getByText('Load results')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();

  // --- Save it back out (SavePackageDialog). Its preview effect fires on open, so wait for
  // the summary line before touching Download — the anchor's href is not gated on the
  // preview promise, only the visible affordance to click it responsibly is. ---
  await page.getByRole('button', { name: 'Save package…' }).click();
  await expect(dialog).toBeVisible();
  // Default scope is "Every entry" (PackageScope 'all'); the summary line never pluralizes
  // its counts (spec-known "1 workflows" wording — see the Load-results dialog's own "1
  // workflows" impact-summary text elsewhere in this suite), so this substring is exactly
  // what one loaded workflow renders as.
  await expect(page.getByText(/1 workflows/i)).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download' }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe(`${WC_NAME}.WFcenterX`);

  const zipPath = await download.path();
  const zip = new AdmZip(zipPath!);
  const names = zip.getEntries().map((e) => e.entryName);
  expect(names).toContain(`${WC_NAME}.WFcenter`);
  expect(names).toContain('roles/roles.json');
  expect(names).toContain('roles/allowed-roles.json');
  expect(names.some((n) => n.startsWith(`workflows/${WC_NAME}/`))).toBe(true);

  // The manifest must describe the workflow that was actually loaded.
  const manifest = JSON.parse(zip.getEntry(`${WC_NAME}.WFcenter`)!.getData().toString('utf8'));
  expect(manifest.format).toBe('WFcenter');
  expect(manifest.workCenters[0].workflows[0].name).toBe('E2E Sample Workflow');
});
