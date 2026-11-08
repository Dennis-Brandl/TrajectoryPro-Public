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
// Mission XO History (spec 2026-11-07): a runtime that finishes on its own appears in History as
// Completed, opens as the record (Starting parameters, Step log, Outputs), and Download PDF saves
// the same file name Commander uses for that record. Runs at desktop, tablet and phone sizes; each
// project builds its own work center and workflow (names carry the project).
import { test, expect, type Browser, type TestInfo } from '@playwright/test';
import { bootstrapFirstAdmin, signIn } from './helpers/auth';
import { ADMIN, STEWARD } from './helpers/db';
import { createWorkCenter, load, assignStewardToWorkCenter } from './helpers/pilot';
import { machineWorkflowPackage } from './helpers/packages';
import { openRail } from './helpers/rail';
import { signInXo } from './helpers/xo';
import { pdfFileName } from '../src/components/history/record/record-model';

test.describe.configure({ mode: 'serial' });

const names = (project: string) => ({ wc: `XO History WC ${project}`, wf: `XO History Flow ${project}` });

test('setup: a work center the Steward can see, with a workflow that finishes on its own', async ({ page, request }, testInfo) => {
  const n = names(testInfo.project.name);
  await bootstrapFirstAdmin(request);
  await signIn(page, ADMIN.email, ADMIN.password);
  // Idempotent: a run that died midway leaves some of this behind.
  const wcs = new Set(((await (await page.request.get('/api/work-centers')).json()) as { nodes: Array<{ name: string }> }).nodes.map((w) => w.name));
  const wfs = new Set(((await (await page.request.get('/api/workflows')).json()) as { workflows: Array<{ name: string }> }).workflows.map((w) => w.name));
  if (!wcs.has(n.wc)) await createWorkCenter(page, n.wc);
  else if (!wfs.has(n.wf)) {
    await openRail(page, 'Work Centers');
    await page.getByRole('button', { name: n.wc, exact: true }).click();
    await expect(page.getByRole('heading', { name: n.wc })).toBeVisible();
  }
  if (!wfs.has(n.wf)) await load(page, machineWorkflowPackage({ localId: n.wf, oid: `e2e-xohist-${testInfo.project.name}` }));
  await assignStewardToWorkCenter(page, n.wc, { missionSystemCommander: true });
});

// A separate browser context (own cookie jar); starts a runtime and waits, by polling Commander's
// API, until its record is in the work center's history.
async function runToCompletion(browser: Browser, testInfo: TestInfo, n: { wc: string; wf: string }) {
  const ctx = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  try {
    const admin = await ctx.newPage();
    await signIn(admin, ADMIN.email, ADMIN.password);
    const wcs = (await (await admin.request.get('/api/work-centers')).json()) as { nodes: Array<{ id: string; name: string }> };
    const wc = wcs.nodes.find((w) => w.name === n.wc);
    expect(wc, `work center ${n.wc} exists`).toBeTruthy();
    const wcId = wc!.id;
    const wfs = (await (await admin.request.get('/api/workflows')).json()) as { workflows: Array<{ id: string; name: string }> };
    const wf = wfs.workflows.find((w) => w.name === n.wf);
    expect(wf, `workflow ${n.wf} exists`).toBeTruthy();
    const wfId = wf!.id;
    const res = await admin.request.post(`/api/workflows/${wfId}/runtime-workflows`, { data: { params: {}, start: true } });
    expect(res.ok()).toBeTruthy();
    const label = ((await res.json()) as { runtimeLabel: string }).runtimeLabel;
    await expect.poll(async () => {
      const body = (await (await admin.request.get(`/api/work-centers/${wcId}/runtime-history`)).json()) as {
        history: Array<{ runtimeLabel: string; finalState: string }>;
      };
      return body.history.find((h) => h.runtimeLabel === label)?.finalState;
    }, { timeout: 30_000 }).toBe('completed');
    return label;
  } finally {
    await ctx.close();
  }
}

test('a finished runtime shows in History, opens as the record and downloads the PDF Commander would', async ({ page, browser }, testInfo) => {
  const n = names(testInfo.project.name);
  // The e2e runs XO's Vite DEV server, which transforms and optimises jsPDF on the first dynamic
  // import (production serves a prebuilt bundle). The timeout covers the worst-case waits
  // (poll 30 s + row 20 s + record 15 s + download 60 s = 125 s) plus sign-in and navigation.
  test.setTimeout(150_000);
  const label = await runToCompletion(browser, testInfo, n);

  await signInXo(page, STEWARD);
  await page.getByRole('button', { name: new RegExp(n.wc) }).click();
  // Rail (desktop), tab (tablet) or bottom bar (phone); the item's name is "History".
  await page.getByRole('tab', { name: 'History', exact: true }).or(page.getByRole('button', { name: 'History', exact: true })).first().click();

  const row = page.getByRole('option', { name: new RegExp(`${n.wf}.*${label}`) });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row).toContainText(/completed/i);
  await row.click();

  const record = page.getByRole('article', { name: 'Record' });
  await expect(record).toBeVisible({ timeout: 15_000 });
  await expect(record).toContainText(n.wf);
  for (const h of ['Starting parameters', 'Step log', 'Outputs']) {
    await expect(record.getByRole('heading', { name: h })).toBeVisible();
  }
  // Wide layouts show the log as a table; a phone shows it as cards.
  if ((testInfo.project.use.viewport?.width ?? 1440) >= 768) {
    await expect(record.locator('th')).toHaveText(['Time', 'Step', 'Run', 'Result', 'Performed by']);
    await expect(record.locator('tbody tr').filter({ hasText: 'Begin' }).first()).toBeVisible();
  } else {
    await expect(record.locator('li').filter({ hasText: 'Begin' }).first()).toBeVisible();
  }

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    page.getByRole('button', { name: 'Download PDF' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe(pdfFileName({ runtimeLabel: label, masterName: n.wf }));
  // Independent of the shared function: the rule's visible output is "<runtime label> - <workflow name>.pdf".
  expect(download.suggestedFilename()).toBe(`${label} - XO History Flow ${testInfo.project.name}.pdf`);
  expect(label).toMatch(/^RW-\d+$/);
});
