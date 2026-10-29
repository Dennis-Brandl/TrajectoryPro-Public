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
// Pilot UX P1d (spec 2026-10-09 §18 E2E bullet; audit 3 §6): the Pilot frame at the three
// sizes the spec names. Two runtimes of the same workflow park the same step ("Fill
// Details") — the "two Charge Kettle batches" case — so the tabs must tell them apart by
// runtime ID. At 1920×1080, 1024×768 and 768×1024, with the work area scrolled to Submit,
// the work center and runtime ID stay on screen (the workflow too at desktop width) and
// every visible control is at least 44×44. Then Submit on one batch moves to the other with
// the toast, the "Now on" banner and focus on its heading (R9), and the Workflows tab draws
// names inside the nodes at no less than natural size. The theme bullets of §18 are P2/P3.
//
// The setup helpers live in helpers/pilot.ts, shared with pilot-options.spec.ts (Pilot P4).
// Every Pilot button locator uses exact:true (cockpit-chains.spec.ts header).
import { test, expect } from '@playwright/test';
import { bootstrapFirstAdmin, signIn } from './helpers/auth';
import { ADMIN, STEWARD } from './helpers/db';
import { uiWorkflowPackage } from './helpers/packages';
import { PILOT, createWorkCenter, load, assignStewardToWorkCenter, createAndStart, smallControls } from './helpers/pilot';

const WC_NAME = 'E2E Frame WC';
const WF_NAME = 'E2E Frame Workflow';
const SIZES = [
  { label: 'desktop 1920×1080', width: 1920, height: 1080, desktop: true },
  { label: 'tablet 1024×768', width: 1024, height: 768, desktop: false },
  { label: 'tablet 768×1024', width: 768, height: 1024, desktop: false },
];

test('the Pilot frame keeps the three facts on screen at every size, and Submit moves to the next batch', async ({ page, browser, request }) => {
  test.setTimeout(240_000);
  await bootstrapFirstAdmin(request);
  await signIn(page, ADMIN.email, ADMIN.password);
  await createWorkCenter(page, WC_NAME);
  await load(page, uiWorkflowPackage({ localId: WF_NAME, oid: 'e2e-frame-1' }));
  await assignStewardToWorkCenter(page, WC_NAME);
  await createAndStart(page, WF_NAME, 'RW-1');
  await createAndStart(page, WF_NAME, 'RW-2');

  const operator = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const pilot = await operator.newPage();
  await pilot.goto(PILOT);
  await pilot.getByLabel('Email').fill(STEWARD.email);
  await pilot.getByLabel('Password').fill(STEWARD.password);
  await pilot.getByRole('button', { name: 'Sign In', exact: true }).click();

  // §5.5 picker card: named by the bare work-center name, described by its open-task count.
  const card = pilot.getByRole('button', { name: WC_NAME, exact: true });
  await expect(card).toHaveAccessibleDescription(/open task/);
  await card.click();

  // §5.5 inbox: one row per batch; the filter narrows by runtime ID.
  const fillRows = pilot.getByRole('listitem').filter({ hasText: 'Fill Details' });
  await expect(fillRows).toHaveCount(2, { timeout: 30_000 });
  const filter = pilot.getByRole('searchbox', { name: 'Filter by step, workflow or runtime ID' });
  await filter.fill('RW-2');
  await expect(fillRows).toHaveCount(1);
  await expect(fillRows).toContainText('RW-2');
  await filter.fill('');
  await expect(fillRows).toHaveCount(2);
  for (const size of SIZES) {
    await pilot.setViewportSize({ width: size.width, height: size.height });
    expect(await smallControls(pilot), `inbox at ${size.label}`).toEqual([]);
  }
  await pilot.setViewportSize({ width: 1920, height: 1080 });

  // Claim both batches of the same step.
  for (const rw of ['RW-1', 'RW-2']) {
    await pilot.getByRole('tab', { name: /^Inbox/ }).click();
    const offer = pilot.getByRole('listitem').filter({ hasText: 'Fill Details' }).filter({ hasText: rw })
      .filter({ has: pilot.getByRole('button', { name: 'Claim', exact: true }) });
    await offer.getByRole('button', { name: 'Claim', exact: true }).click();
    await expect(pilot.getByRole('tab', { name: new RegExp(`Fill Details · ${rw}`) })).toBeVisible({ timeout: 30_000 });
  }

  // Same step, two batches: the tabs differ by runtime ID (§5.2).
  const tab1 = pilot.getByRole('tab', { name: /Fill Details · RW-1/ });
  const tab2 = pilot.getByRole('tab', { name: /Fill Details · RW-2/ });
  await expect(tab1.locator('.claim-tab-meta')).toContainText('RW-1');
  await expect(tab2.locator('.claim-tab-meta')).toContainText('RW-2');

  const pane = pilot.locator('[role="tabpanel"]:not([hidden])');
  const bar = pilot.locator('.context-bar');
  for (const size of SIZES) {
    await pilot.setViewportSize({ width: size.width, height: size.height });
    await tab1.click();
    await expect(pane.getByLabel('Reason')).toBeVisible();
    // Scroll the work area to the bottom, where Submit lives.
    await pilot.locator('.work-panes').evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect(pilot.getByRole('button', { name: 'Continue', exact: true })).toBeInViewport();
    await expect(bar.locator('.ctx-runtime')).toBeInViewport();
    await expect(bar.locator('.ctx-runtime')).toContainText('RW-1');
    await expect(bar.locator('.ctx-wc')).toBeInViewport();
    await expect(bar.locator('.ctx-wc')).toContainText(WC_NAME);
    if (size.desktop) {
      await expect(bar.locator('.ctx-workflow')).toBeInViewport();
      await expect(bar.locator('.ctx-workflow')).toContainText(WF_NAME);
    }
    expect(await smallControls(pilot), `task at ${size.label}`).toEqual([]);
  }

  // R9 (§5.6): Submit on RW-1 moves to the other open claim, with the toast, the banner, and
  // focus on its heading — never inside its form.
  await pilot.setViewportSize({ width: 1920, height: 1080 });
  await tab1.click();
  await pane.getByLabel('Reason').fill('frame check');
  await pilot.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(pilot.getByText('Submitted Fill Details · RW-1')).toBeVisible({ timeout: 30_000 });
  await expect(tab1).toHaveCount(0, { timeout: 30_000 });
  await expect(pane.locator('.task-arrival')).toContainText('Now on: Fill Details');
  await expect(pane.locator('.task-arrival')).toContainText('RW-2');
  await expect(pilot.locator(':focus')).toHaveClass(/task-heading/);

  // §5.7: names inside the nodes, drawn at no less than natural size (labels ≥ 11 px).
  await pilot.getByRole('tab', { name: /^Workflows/ }).click();
  const node = pilot.locator('g[data-step-name="Fill Details"]').first();
  await expect(node).toBeVisible({ timeout: 30_000 });
  await expect(node.locator('text').first()).toContainText('Fill Details');
  const scale = await pilot.locator('.wf-graph-svg').evaluate((svg) => (svg as SVGSVGElement).getScreenCTM()!.a);
  expect(scale).toBeGreaterThanOrEqual(1);

  await operator.close();
});
