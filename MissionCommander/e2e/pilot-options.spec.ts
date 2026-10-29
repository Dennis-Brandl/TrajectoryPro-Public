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
// Pilot UX P4 (spec 2026-10-09 §15, §16; plan rulings P4-R1..R6): the keyboard shortcuts
// and the Workstation layout against the real engine. Two runtimes of the same workflow park
// "Fill Details"; Alt+digit walks the claim tabs, `/` and `?` work outside text fields,
// Ctrl+Shift+C copies the runtime ID, Ctrl+Enter submits only once Submit is enabled. Then
// Workstation keeps the inbox in a left column beside the task at 1920 and 1280 px, with no
// horizontal scroll and every control at least 44×44, and falls back to Standard at 1024.
import { test, expect } from '@playwright/test';
import { bootstrapFirstAdmin, signIn } from './helpers/auth';
import { ADMIN, STEWARD } from './helpers/db';
import { uiWorkflowPackage } from './helpers/packages';
import { createWorkCenter, load, assignStewardToWorkCenter, createAndStart, smallControls, signInPilot } from './helpers/pilot';

const WC_NAME = 'E2E Options WC';
const WF_NAME = 'E2E Options Workflow';

test('keyboard shortcuts and the Workstation layout work against the real engine (spec §15, §16)', async ({ page, browser, request }) => {
  test.setTimeout(240_000);
  await bootstrapFirstAdmin(request);
  await signIn(page, ADMIN.email, ADMIN.password);
  await createWorkCenter(page, WC_NAME);
  await load(page, uiWorkflowPackage({ localId: WF_NAME, oid: 'e2e-options-1' }));
  await assignStewardToWorkCenter(page, WC_NAME);
  await createAndStart(page, WF_NAME, 'RW-1');
  await createAndStart(page, WF_NAME, 'RW-2');

  const operator = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const pilot = await operator.newPage();
  await signInPilot(pilot, STEWARD.email, STEWARD.password);
  await pilot.getByRole('button', { name: WC_NAME, exact: true }).click();

  for (const rw of ['RW-1', 'RW-2']) {
    await pilot.getByRole('tab', { name: /^Inbox/ }).click();
    const offer = pilot.getByRole('listitem').filter({ hasText: 'Fill Details' }).filter({ hasText: rw })
      .filter({ has: pilot.getByRole('button', { name: 'Claim', exact: true }) });
    await expect(offer).toHaveCount(1, { timeout: 30_000 });
    await offer.getByRole('button', { name: 'Claim', exact: true }).click();
    await expect(pilot.getByRole('tab', { name: new RegExp(`Fill Details · ${rw}`) })).toBeVisible({ timeout: 30_000 });
  }
  const tab1 = pilot.getByRole('tab', { name: /Fill Details · RW-1/ });
  const tab2 = pilot.getByRole('tab', { name: /Fill Details · RW-2/ });
  const inboxTab = pilot.getByRole('tab', { name: /^Inbox/ });

  // P4-R1: Alt+digit by claim order; Alt+0 the inbox.
  await pilot.keyboard.press('Alt+2');
  await expect(tab2).toHaveAttribute('aria-selected', 'true');
  await pilot.keyboard.press('Alt+1');
  await expect(tab1).toHaveAttribute('aria-selected', 'true');
  await pilot.keyboard.press('Alt+0');
  await expect(inboxTab).toHaveAttribute('aria-selected', 'true');

  // P4-R4: `/` from a task jumps to the filter; `?` opens the list; Escape closes it.
  await pilot.keyboard.press('Alt+1');
  await pilot.locator('.task-heading:visible').focus();
  await pilot.keyboard.press('/');
  await expect(inboxTab).toHaveAttribute('aria-selected', 'true');
  await expect(pilot.getByRole('searchbox', { name: 'Filter by step, workflow or runtime ID' })).toBeFocused();
  await pilot.getByRole('heading', { name: 'My tasks' }).focus();
  await pilot.keyboard.press('Shift+Slash');
  await expect(pilot.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  await pilot.keyboard.press('Escape');
  await expect(pilot.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeHidden();

  // P4-R3: Ctrl+Shift+C copies the open task's runtime ID.
  await pilot.keyboard.press('Alt+1');
  await pilot.locator('.task-heading:visible').focus();
  await pilot.keyboard.press('Control+Shift+C');
  await expect(pilot.locator('.ctx-copy-status')).toHaveText('Copied');
  expect(await pilot.evaluate(() => navigator.clipboard.readText())).toContain('RW-1');

  // P4-R2: Ctrl+Enter does nothing while Submit is disabled; from inside the field it submits.
  const pane = pilot.locator('[role="tabpanel"]:not([hidden])');
  const reason = pane.getByLabel('Reason');
  await reason.focus();
  await pilot.keyboard.press('Control+Enter');
  await expect(tab1).toBeVisible();
  await reason.fill('shortcut check');
  await reason.focus();
  await pilot.keyboard.press('Control+Enter');
  await expect(pilot.getByText('Submitted Fill Details · RW-1')).toBeVisible({ timeout: 30_000 });
  await expect(tab1).toHaveCount(0, { timeout: 30_000 });

  // Spec §16: Workstation from the operator menu.
  await pilot.locator('.op-btn').click();
  const menu = pilot.getByRole('dialog', { name: 'Operator menu' });
  await menu.getByLabel('Layout').selectOption('workstation');
  await pilot.keyboard.press('Escape');

  const rail = pilot.getByRole('complementary', { name: 'Inbox' });
  for (const size of [
    { width: 1920, height: 1080 },
    { width: 1280, height: 800 },
  ]) {
    await pilot.setViewportSize(size);
    await expect(rail).toBeVisible();
    await tab2.click();
    await expect(pane.getByLabel('Reason')).toBeVisible();
    await expect(rail.getByRole('heading', { name: 'My tasks' })).toBeInViewport();
    await pilot.locator('.work-panes').evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect(pilot.getByRole('button', { name: 'Continue', exact: true })).toBeInViewport();
    await expect(pilot.locator('.context-bar .ctx-runtime')).toBeInViewport();
    await expect(pilot.locator('.context-bar .ctx-wc')).toBeInViewport();
    const hScroll = await pilot.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(hScroll, `horizontal scroll at ${size.width}`).toBe(false);
    expect(await smallControls(pilot), `workstation at ${size.width}`).toEqual([]);
  }

  // Below 1280 px Workstation falls back to Standard.
  await pilot.setViewportSize({ width: 1024, height: 768 });
  await expect(rail).toHaveCount(0);
  await inboxTab.click();
  await expect(pilot.getByRole('heading', { name: 'My tasks' })).toBeVisible();

  await operator.close();
});
