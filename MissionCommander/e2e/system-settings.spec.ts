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
// Spec 2026-08-20: the system-wide action-matching setting — default Loose, admin flips
// Strict, persists across reload, flips back.
import { test, expect } from '@playwright/test';
import { bootstrapFirstAdmin, signIn } from './helpers/auth';
import { ADMIN } from './helpers/db';

test('action matching setting defaults loose, persists a strict flip', async ({ page, request }) => {
  await bootstrapFirstAdmin(request);
  await signIn(page, ADMIN.email, ADMIN.password);

  await page.getByRole('button', { name: 'Settings' }).click(); // activity rail
  const group = page.getByRole('radiogroup', { name: 'Action matching' });
  await expect(group.getByRole('radio').first()).toBeChecked(); // Loose (default)

  await group.getByRole('radio').nth(1).check(); // Strict
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  // Sync on the success toast before reloading — .click() only awaits event dispatch,
  // not SettingsPanel's async save handler, so an unsynced reload can abort the in-flight
  // PUT and make the persistence assertion below racy (mirrors history.spec.ts's toast-sync
  // convention).
  await expect(page.getByText('Settings saved')).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(group.getByRole('radio').nth(1)).toBeChecked();

  await group.getByRole('radio').first().check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  // Sync on the final flip-back's toast too — otherwise the test can end (and the DB
  // fixture reset) before the PUT lands, leaving the DB in Strict for later specs.
  await expect(page.getByText('Settings saved')).toBeVisible();
});

test('action-server trust: allowlist round-trips and Loose shows its warning', async ({ page, request }) => {
  await bootstrapFirstAdmin(request);
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.getByRole('button', { name: 'Settings' }).click();
  const box = page.getByRole('textbox', { name: 'Allowed action servers' });
  await box.fill('http://mission-autopilot-server:3002\nhttp://second:3002');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Settings saved')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('textbox', { name: 'Allowed action servers' })).toHaveValue('http://mission-autopilot-server:3002\nhttp://second:3002');
  const trust = page.getByRole('radiogroup', { name: 'Action server trust' });
  await trust.getByRole('radio').nth(1).check(); // Loose
  await expect(page.getByRole('alert')).toContainText('Loose disables');
  await trust.getByRole('radio').first().check(); // back to Strict
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Settings saved')).toBeVisible();
});
