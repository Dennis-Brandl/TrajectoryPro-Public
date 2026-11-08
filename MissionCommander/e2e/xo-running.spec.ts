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
// Mission XO Running and control (spec 2026-11-07): the Steward sees a started runtime, pauses it
// (it moves under "Needs attention"), resumes it and aborts it behind a confirmation; in a work
// center where they are not a Mission System Commander every control is disabled and the
// view-only banner shows. Runs at desktop, tablet and phone sizes; each project builds its own
// work centers, workflows and runtimes (names carry the project) on the shared reset-once DB.
import { test, expect, type Browser, type Page, type TestInfo } from '@playwright/test';
import { bootstrapFirstAdmin, signIn } from './helpers/auth';
import { ADMIN, STEWARD } from './helpers/db';
import { createWorkCenter, load, assignStewardToWorkCenter } from './helpers/pilot';
import { uiWorkflowPackage } from './helpers/packages';
import { openRail } from './helpers/rail';
import { signInXo } from './helpers/xo';

test.describe.configure({ mode: 'serial' });

const VIEW_ONLY = 'View only — you are not a Mission System Commander in this work center.';

type Names = { wcFull: string; wcView: string; wfFull: string; wfView: string };
function names(project: string): Names {
  return {
    wcFull: `XO Run Commander WC ${project}`,
    wcView: `XO Run View WC ${project}`,
    wfFull: `XO Run Flow ${project} A`,
    wfView: `XO Run Flow ${project} B`,
  };
}

// A separate browser context: the admin cookie must not share a jar with the Steward's XO page.
async function startRuntimeAsAdmin(browser: Browser, testInfo: TestInfo, wfName: string): Promise<string> {
  const ctx = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  try {
    const admin = await ctx.newPage();
    await signIn(admin, ADMIN.email, ADMIN.password);
    return await startRuntime(admin, wfName);
  } finally {
    await ctx.close();
  }
}

// The detail's header: workflow name (h1) plus the status badge and the runtime label line.
function detailHeader(page: Page, wfName: string) {
  return page.locator('header').filter({ has: page.getByRole('heading', { level: 1, name: wfName }) });
}

async function workflowId(page: Page, name: string): Promise<string> {
  const { workflows } = (await (await page.request.get('/api/workflows')).json()) as {
    workflows: Array<{ id: string; name: string }>;
  };
  const wf = workflows.find((w) => w.name === name);
  if (!wf) throw new Error(`workflow not found: ${name}`);
  return wf.id;
}

// Created and started through Commander's API; the UI step keeps it running until an operator acts.
async function startRuntime(page: Page, wfName: string): Promise<string> {
  const id = await workflowId(page, wfName);
  const res = await page.request.post(`/api/workflows/${id}/runtime-workflows`, { data: { params: {}, start: true } });
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { runtimeLabel: string }).runtimeLabel;
}

test('setup: a work center the Steward commands and one they do not, each with a workflow', async ({ page, request }, testInfo) => {
  const n = names(testInfo.project.name);
  const project = testInfo.project.name;
  await bootstrapFirstAdmin(request);
  await signIn(page, ADMIN.email, ADMIN.password);
  // Both projects of a size share the reset-once database, and a run that died midway leaves some
  // of this behind: check every resource and create only what is missing.
  const have = async () => ({
    wcs: new Set(((await (await page.request.get('/api/work-centers')).json()) as { nodes: Array<{ name: string }> }).nodes.map((w) => w.name)),
    wfs: new Set(((await (await page.request.get('/api/workflows')).json()) as { workflows: Array<{ name: string }> }).workflows.map((w) => w.name)),
  });
  const ensure = async (wc: string, wf: string, oid: string) => {
    const now = await have();
    if (!now.wcs.has(wc)) await createWorkCenter(page, wc);
    else if (!now.wfs.has(wf)) {
      await openRail(page, 'Work Centers');
      await page.getByRole('button', { name: wc, exact: true }).click();
      await expect(page.getByRole('heading', { name: wc })).toBeVisible();
    }
    if (!now.wfs.has(wf)) await load(page, uiWorkflowPackage({ localId: wf, oid }));
  };
  await ensure(n.wcFull, n.wfFull, `e2e-xorun-a-${project}`);
  await ensure(n.wcView, n.wfView, `e2e-xorun-b-${project}`);
  // The assign route is an idempotent upsert; always re-apply it.
  await assignStewardToWorkCenter(page, n.wcFull, { missionSystemCommander: true });
  await assignStewardToWorkCenter(page, n.wcView);
});

test('a Steward pauses, resumes and aborts a runtime', async ({ page, browser }, testInfo) => {
  const n = names(testInfo.project.name);
  const label = await startRuntimeAsAdmin(browser, testInfo, n.wfFull);

  await signInXo(page, STEWARD);
  await page.getByRole('button', { name: new RegExp(n.wcFull) }).click();

  const row = page.getByRole('option', { name: new RegExp(`${n.wfFull}.*${label}`) });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();

  // Below 1024 px wide the detail replaces the list and has a Back button (desktop and wide tablet split).
  const stacked = (testInfo.project.use.viewport?.width ?? 1440) < 1024;
  const toList = async () => {
    if (!stacked) return;
    const back = page.getByRole('button', { name: 'Back' });
    await expect(back).toBeVisible();
    await back.click();
  };
  const status = (text: string) => detailHeader(page, n.wfFull).getByText(text, { exact: true });

  // Pause: the runtime reports Paused and moves under "Needs attention".
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(status('Paused')).toBeVisible({ timeout: 15_000 });
  await toList();
  const attention = page.getByRole('group', { name: 'Needs attention' });
  await expect(attention.getByRole('option', { name: new RegExp(label) })).toBeVisible({ timeout: 15_000 });
  await attention.getByRole('option', { name: new RegExp(label) }).click();

  // Resume: it leaves "Needs attention".
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible({ timeout: 15_000 });
  await toList();
  await expect(page.getByRole('group', { name: 'Needs attention' })).toBeHidden({ timeout: 15_000 });
  await page.getByRole('option', { name: new RegExp(label) }).click();

  // Abort asks first; Cancel changes nothing, confirming aborts.
  await page.getByRole('button', { name: 'Abort…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Abort this runtime?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Abort…' }).click();
  await dialog.getByRole('button', { name: 'Abort runtime' }).click();
  await expect(status('Aborted')).toBeVisible({ timeout: 15_000 });
});

test('a work center the Steward does not command is view only', async ({ page, browser }, testInfo) => {
  const n = names(testInfo.project.name);
  const label = await startRuntimeAsAdmin(browser, testInfo, n.wfView);

  await signInXo(page, STEWARD);
  await page.getByRole('button', { name: new RegExp(n.wcView) }).click();
  const row = page.getByRole('option', { name: new RegExp(`${n.wfView}.*${label}`) });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();

  await expect(page.getByText(VIEW_ONLY)).toBeVisible();
  // Every button in the detail (the nearest ancestor of its title that holds the controls, which on
  // a phone includes the sticky bottom bar) must be disabled; only read-only navigation (Back, the Diagram opener, diagram zoom) may stay live.
  const detail = page.getByRole('heading', { level: 1, name: n.wfView })
    .locator('xpath=ancestor::div[.//button[normalize-space(.)="Stop"]][1]');
  await expect(detail.getByRole('button', { name: 'Stop', exact: true })).toBeDisabled();
  for (const name of ['Pause', 'Abort…']) {
    await expect(detail.getByRole('button', { name, exact: name === 'Pause' })).toBeDisabled();
  }
  const enabled = await detail.getByRole('button').evaluateAll((els) =>
    els.filter((e) => !(e as HTMLButtonElement).disabled && (e as HTMLElement).offsetParent !== null)
      .map((e) => (e.getAttribute('aria-label') ?? e.textContent ?? '').trim()));
  const viewing = new Set(['Back', 'Diagram', 'Zoom in', 'Zoom out', 'Reset zoom']);
  expect(enabled.filter((t) => !viewing.has(t)), `enabled buttons in a view-only detail: ${enabled.join(' | ')}`).toEqual([]);
});
