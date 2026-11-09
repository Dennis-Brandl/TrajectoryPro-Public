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
import { test, expect, type Locator, type Page } from '@playwright/test';
import { bootstrapFirstAdmin, signIn } from './helpers/auth';
import { ADMIN, STEWARD } from './helpers/db';
import { createWorkCenter, load, assignStewardToWorkCenter } from './helpers/pilot';
import { machineWorkflowPackage } from './helpers/packages';
import { openRail } from './helpers/rail';
import { signInXo } from './helpers/xo';

test.describe.configure({ mode: 'serial' });

const VIEW_ONLY = 'View only — you are not a Mission System Commander in this work center.';

function names(project: string) {
  return {
    wcFull: `XO Sched Commander WC ${project}`,
    wcView: `XO Sched View WC ${project}`,
    wf: `XoSchedFlow${project.replace(/\W/g, '')}`,
    runMaster: 'Hourly batch',
    spareMaster: 'Spare batch',
  };
}

type Ids = { wcId: string; label: string };

// Masters and Runtime Schedules are made through Commander's REST routes: XO has no editor, and the
// editor itself is proved in schedules.spec.ts. The workflows are loaded through the UI.
async function seedSchedules(page: Page, wcName: string, wfName: string, masters: string[], enableFirst: boolean): Promise<Ids> {
  const wcs = (await (await page.request.get('/api/work-centers')).json()) as { nodes: Array<{ id: string; name: string }> };
  const wcId = wcs.nodes.find((w) => w.name === wcName)!.id;
  const have = (await (await page.request.get(`/api/work-centers/${wcId}/master-schedules`)).json()) as Array<{ id: string; name: string }>;
  const ids = new Map(have.map((m) => [m.name, m.id]));
  for (const name of masters) {
    if (ids.has(name)) continue;
    const res = await page.request.post(`/api/work-centers/${wcId}/master-schedules`, {
      data: {
        name, recurrence: { type: 'interval', every: 1, unit: 'hours', startAt: '2026-01-01T00:00' },
        items: [{ workflow: { name: wfName } }],
      },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    ids.set(name, ((await res.json()) as { id: string }).id);
  }
  const runtimes = async () => (await (await page.request.get(`/api/work-centers/${wcId}/runtime-schedules`)).json()) as Array<{ id: string; label: string; status: string }>;
  let live = (await runtimes()).find((r) => r.status === 'active' || r.status === 'paused');
  if (!live && enableFirst) {
    const res = await page.request.post(`/api/master-schedules/${ids.get(masters[0])}/enable`);
    expect(res.ok(), await res.text()).toBeTruthy();
    live = (await runtimes()).find((r) => r.status === 'active' || r.status === 'paused');
  }
  return { wcId, label: live!.label };
}

const openSchedules = async (page: Page) => {
  await page.getByRole('tab', { name: /^Schedules/ }).or(page.getByRole('button', { name: /^Schedules/ })).first().click();
  await expect(page).toHaveURL(/\/schedules$/);
};

// The view (everything inside <main>, plus the navigation bar) must fit the screen width. Names what
// sticks out, so a failure says where. The app header is shared by every XO view and is not judged here.
async function noHorizontalScroll(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const out: string[] = [];
    const main = document.querySelector('main');
    if (main && main.scrollWidth > main.clientWidth + 1) out.push(`MAIN scroll ${main.scrollWidth} > client ${main.clientWidth}`);
    const vw = document.documentElement.clientWidth;
    const parts = [main, document.querySelector('[data-testid="xo-bottom-bar"]')].filter((p): p is HTMLElement => !!p);
    for (const e of parts.flatMap((p) => Array.from(p.querySelectorAll('*')).slice(0, 3000))) {
      const r = e.getBoundingClientRect();
      if (r.width > 0 && r.right > vw + 1) out.push(`${e.tagName} "${(e.textContent ?? '').slice(0, 30)}" right ${Math.round(r.right)} > ${vw}`);
    }
    return out.slice(0, 6);
  }), { message: 'the page scrolls sideways' }).toEqual([]);
}

// Polled, because a dialog slides in when it opens and only then sits where it will stay. Judged against
// the window the page is laid out in: the shared app header is about 12 px wider than a 390 px phone
// (see the note at noHorizontalScroll), which makes a phone browser lay the page out that much wider.
async function fitsScreen(page: Page, dialog: Locator) {
  await expect.poll(async () => {
    const vp = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
    const box = (await dialog.boundingBox())!;
    const over: string[] = [];
    if (box.x < 0) over.push(`left edge ${Math.round(box.x)}`);
    if (box.y < 0) over.push(`top edge ${Math.round(box.y)}`);
    if (box.x + box.width > vp.width + 1) over.push(`right edge ${Math.round(box.x + box.width)} > ${vp.width}`);
    if (box.y + box.height > vp.height + 1) over.push(`bottom edge ${Math.round(box.y + box.height)} > ${vp.height}`);
    return over;
  }, { message: 'the dialog does not fit the screen' }).toEqual([]);
}

test('setup: a Steward who commands a work center and one who does not, each with a schedule', async ({ page, request }, testInfo) => {
  const n = names(testInfo.project.name);
  await bootstrapFirstAdmin(request);
  await signIn(page, ADMIN.email, ADMIN.password);
  const have = async () => ({
    wcs: new Set(((await (await page.request.get('/api/work-centers')).json()) as { nodes: Array<{ name: string }> }).nodes.map((w) => w.name)),
    wfs: new Set(((await (await page.request.get('/api/workflows')).json()) as { workflows: Array<{ name: string }> }).workflows.map((w) => w.name)),
  });
  for (const wc of [n.wcFull, n.wcView]) {
    if (!(await have()).wcs.has(wc)) await createWorkCenter(page, wc);
    // The workflow row is per work center, so each loads its own copy under a distinct oid.
    const oid = `e2e-xosched-${testInfo.project.name}-${wc === n.wcFull ? 'a' : 'b'}`;
    const wfName = wc === n.wcFull ? n.wf : `${n.wf}B`;
    if (!(await have()).wfs.has(wfName)) {
      await openRail(page, 'Work Centers');
      await page.getByRole('button', { name: wc, exact: true }).click();
      await expect(page.getByRole('heading', { name: wc })).toBeVisible();
      await load(page, machineWorkflowPackage({ localId: wfName, oid }));
    }
  }
  await assignStewardToWorkCenter(page, n.wcFull, { missionSystemCommander: true });
  await assignStewardToWorkCenter(page, n.wcView);
  await seedSchedules(page, n.wcFull, n.wf, [n.runMaster, n.spareMaster], true);
  await seedSchedules(page, n.wcView, `${n.wf}B`, [n.runMaster], true);
});

test('a Steward who commands the work center sees Schedules, pauses and resumes, and enables from a Master', async ({ page }, testInfo) => {
  const n = names(testInfo.project.name);
  await signInXo(page, STEWARD);
  await page.getByRole('button', { name: new RegExp(n.wcFull) }).click();
  await openSchedules(page);

  // Runtime Schedules first, then Masters with Enable only.
  const headings = page.getByRole('heading', { level: 2 });
  await expect(headings.nth(0)).toHaveText('Runtime Schedules');
  await expect(headings.nth(1)).toHaveText('Master Schedules');
  const pause = page.getByRole('button', { name: /^Pause RS-\d+$/ }).first();
  await expect(pause).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: `Enable Recurrence ${n.spareMaster}` })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Edit / })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Delete / })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New Master Schedule' })).toHaveCount(0);
  await noHorizontalScroll(page);

  // Pause, then Resume. A slot missed while paused would ask for a decision; a minute is far from the hour.
  const label = ((await pause.getAttribute('aria-label')) ?? '').replace('Pause ', '');
  await pause.click();
  const resume = page.getByRole('button', { name: `Resume ${label}` });
  await expect(resume).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Paused', { exact: true }).first()).toBeVisible();
  await resume.click();
  const decision = page.getByRole('dialog');
  if (await decision.isVisible({ timeout: 2000 }).catch(() => false)) {
    await fitsScreen(page, decision);
    await decision.getByRole('button', { name: 'Resume', exact: true }).click();
  }
  await expect(page.getByRole('button', { name: `Pause ${label}` })).toBeVisible({ timeout: 15_000 });

  // The Cancel dialog fits the screen; closing it changes nothing.
  await page.getByRole('button', { name: `Cancel ${label}` }).click();
  const cancel = page.getByRole('dialog');
  await expect(cancel).toBeVisible();
  await fitsScreen(page, cancel);
  await cancel.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(cancel).toBeHidden();

  // The Enable dialog fits the screen; it is closed without enabling so the run can repeat.
  await page.getByRole('button', { name: `Enable Recurrence ${n.spareMaster}` }).click();
  const enable = page.getByRole('dialog');
  await expect(enable.getByRole('list', { name: 'First fire times' })).toBeVisible();
  await fitsScreen(page, enable);
  await enable.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(enable).toBeHidden();

  // The detail is its own screen: tree, occurrences, Back.
  await page.getByRole('button', { name: label, exact: true }).click();
  await expect(page).toHaveURL(/\/schedules\/[^/]+$/);
  await expect(page.getByRole('heading', { name: new RegExp(`^${label} `) })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Disable / }).first()).toBeVisible();
  await noHorizontalScroll(page);
  await page.getByRole('button', { name: 'Back to Runtime Schedules' }).click();
  await expect(page).toHaveURL(/\/schedules$/);
});

test('a Steward without the commander flag sees the schedules but cannot change them', async ({ page }, testInfo) => {
  const n = names(testInfo.project.name);
  await signInXo(page, STEWARD);
  await page.getByRole('button', { name: new RegExp(n.wcView) }).click();
  await openSchedules(page);
  await expect(page.getByText(VIEW_ONLY)).toBeVisible();
  await expect(page.getByRole('button', { name: /^RS-\d+$/ }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: /^(Pause|Resume|Cancel|Enable|Run Once) / })).toHaveCount(0);
  await noHorizontalScroll(page);
  await page.getByRole('button', { name: /^RS-\d+$/ }).first().click();
  await expect(page.getByRole('heading', { name: /^RS-\d+ / })).toBeVisible();
  await expect(page.getByRole('button', { name: /^(Pause|Resume|Cancel|Disable|Re-enable|Dismiss)/ })).toHaveCount(0);
});
