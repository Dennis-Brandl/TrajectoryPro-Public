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
// Mission XO New (spec 2026-11-07): the Steward picks a workflow, sees the literal starting
// parameter prefilled and the property one resolved at start, presses Start and lands on Running
// with the new runtime selected. Runs at desktop, tablet and phone sizes; each project builds its
// own work center and workflow (names carry the project) on the shared reset-once DB.
import { test, expect } from '@playwright/test';
import { bootstrapFirstAdmin, signIn } from './helpers/auth';
import { ADMIN, STEWARD } from './helpers/db';
import { createWorkCenter, load, assignStewardToWorkCenter } from './helpers/pilot';
import { uiWorkflowPackage } from './helpers/packages';
import { openRail } from './helpers/rail';
import { signInXo } from './helpers/xo';

test.describe.configure({ mode: 'serial' });

const names = (project: string) => ({ wc: `XO New WC ${project}`, wf: `XO New Flow ${project}` });

test('setup: a work center the Steward commands, with a two-parameter workflow', async ({ page, request }, testInfo) => {
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
  if (!wfs.has(n.wf)) {
    await load(page, uiWorkflowPackage({
      localId: n.wf, oid: `e2e-xonew-${testInfo.project.name}`,
      startingParameterSpecifications: [
        { id: 'BatchSize', default_value: '10', value_type: 'literal' },
        { id: 'Plant', default_value: 'Plant 1', value_type: 'property' },
      ],
    }));
  }
  await assignStewardToWorkCenter(page, n.wc, { missionSystemCommander: true });
});

test('a Steward starts a workflow from New and lands on its running runtime', async ({ page }, testInfo) => {
  const n = names(testInfo.project.name);
  await signInXo(page, STEWARD);
  await page.getByRole('button', { name: new RegExp(n.wc) }).click();

  // Open Available: rail (desktop), tab (tablet) or bottom bar (phone).
  await page.getByRole('tab', { name: 'Available', exact: true }).or(page.getByRole('button', { name: 'Available', exact: true })).first().click();

  await page.getByRole('option', { name: new RegExp(n.wf) }).click();
  await expect(page.getByRole('heading', { name: `${n.wf} needs` })).toBeVisible({ timeout: 15_000 });

  // The literal is prefilled; the property one is empty and says where its value comes from.
  await expect(page.getByLabel('BatchSize')).toHaveValue('10');
  await expect(page.getByPlaceholder('Resolved at start: Plant 1')).toHaveValue('');

  // One way to start, and nothing else.
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Create and Wait' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start later' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Start', exact: true }).click();

  // On success XO goes to Running with the new runtime open: its heading and a live status.
  await expect(page).toHaveURL(/\/running\/[^/]+/, { timeout: 20_000 });
  await expect(page.getByText(/ started$/).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('heading', { level: 1, name: n.wf })).toBeVisible({ timeout: 20_000 });
  // The status badge reads "Started" (running) or "Starting" (queued); its label line shows the new RW-label.
  await expect(page.getByText(/^(Started|Starting)$/).first()).toBeVisible({ timeout: 20_000 });
  // Wide screens show the list beside the detail, with the new runtime selected; stacked layouts show the detail alone.
  if ((testInfo.project.use.viewport?.width ?? 1440) >= 1024) {
    await expect(page.getByRole('option', { name: new RegExp(n.wf), selected: true })).toBeVisible();
  }
});
