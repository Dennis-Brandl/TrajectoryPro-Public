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
// Mission XO access (spec 2026-11-07): Stewards and Administrators get the work-center picker,
// Viewers get the not-for-you screen, and a work center where the Steward is not a Mission
// System Commander is listed under "View only". Runs at desktop, tablet and phone sizes.
import { test, expect } from '@playwright/test';
import { bootstrapFirstAdmin, signIn } from './helpers/auth';
import { ADMIN, STEWARD, VIEWER } from './helpers/db';
import { createWorkCenter, assignStewardToWorkCenter } from './helpers/pilot';
import { signInXo } from './helpers/xo';

const WC_FULL = 'XO Access Commander WC';
const WC_VIEW = 'XO Access View WC';

test.describe.configure({ mode: 'serial' });

test('setup: one work center the Steward commands, one they do not', async ({ page, request }) => {
  await bootstrapFirstAdmin(request);
  await signIn(page, ADMIN.email, ADMIN.password);
  // Both projects of a size share the reset-once database; only the first run creates them.
  const existing = (await (await page.request.get('/api/work-centers')).json()) as { nodes: Array<{ name: string }> };
  if (existing.nodes.some((n) => n.name === WC_FULL)) return;
  await createWorkCenter(page, WC_FULL);
  await createWorkCenter(page, WC_VIEW);
  await assignStewardToWorkCenter(page, WC_FULL, { missionSystemCommander: true });
  await assignStewardToWorkCenter(page, WC_VIEW);
});

test('a Steward signs in and sees the work-center picker', async ({ page }) => {
  await signInXo(page, STEWARD);
  await expect(page.getByRole('heading', { name: 'Choose a work center' })).toBeVisible();
});

test('a Viewer is told Mission XO is not for them', async ({ page }) => {
  await signInXo(page, VIEWER);
  await expect(page.getByText('Mission XO is for Stewards and Administrators')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Choose a work center' })).toBeHidden();
});

test('a work center the Steward does not command is marked View only', async ({ page }) => {
  await signInXo(page, STEWARD);
  await expect(page.getByRole('heading', { name: 'Choose a work center' })).toBeVisible();
  const full = page.getByRole('button', { name: new RegExp(WC_FULL) });
  const viewOnly = page.getByRole('button', { name: new RegExp(WC_VIEW) });
  await expect(full).toBeVisible();
  await expect(full).not.toContainText('View only');
  await expect(viewOnly).toContainText('View only');
});
