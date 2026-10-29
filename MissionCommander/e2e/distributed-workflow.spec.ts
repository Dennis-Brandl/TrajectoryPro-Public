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
import { test, expect, type Page } from '@playwright/test';
import { bootstrapFirstAdmin, signIn } from './helpers/auth';
import { ADMIN, E2E_BROKER_TOKEN } from './helpers/db';
import { createWorkCenter, load, createAndStart } from './helpers/pilot';
import {
  dwmChildWorkflowPackage, dwmParentWorkflowPackage, dwmScriptedParentPackage, timedGateWorkflowPackage,
  type FilePayload,
} from './helpers/packages';

const BROKER = 'http://localhost:3007';

async function wcId(page: Page, name: string): Promise<string> {
  const { nodes } = await (await page.request.get('/api/work-centers')).json() as { nodes: Array<{ id: string; name: string }> };
  const hit = nodes.find((n) => n.name === name);
  if (!hit) throw new Error(`work center not found: ${name}`);
  return hit.id;
}

type HistoryDetail = { props: Record<string, string>; createdByLabel: string | null; finalState: string };

async function historyDetail(page: Page, workCenterId: string, label: string, timeout = 60_000): Promise<HistoryDetail> {
  let id: string | undefined;
  await expect.poll(async () => {
    const { history } = await (await page.request.get(`/api/work-centers/${workCenterId}/runtime-history`)).json() as { history: Array<{ id: string; runtimeLabel: string }> };
    id = history.find((h) => h.runtimeLabel === label)?.id;
    return Boolean(id);
  }, { timeout }).toBe(true);
  const d = await (await page.request.get(`/api/runtime-history/${id}`)).json() as { properties: Record<string, string> | null; createdByLabel: string | null; finalState: string };
  return { props: d.properties ?? {}, createdByLabel: d.createdByLabel, finalState: d.finalState };
}

async function liveStatus(page: Page, workCenterId: string, label: string): Promise<{ id: string; status: string } | undefined> {
  const { runtimeWorkflows } = await (await page.request.get(`/api/work-centers/${workCenterId}/runtime-workflows?filter=all`)).json() as { runtimeWorkflows: Array<{ id: string; runtimeLabel: string; status: string }> };
  const hit = runtimeWorkflows.find((r) => r.runtimeLabel === label);
  return hit ? { id: hit.id, status: hit.status } : undefined;
}

async function setupPair(page: Page, opts: { parentWc: string; childWc: string; childPackages: FilePayload[]; parentPackage: FilePayload }): Promise<{ p: string; c: string }> {
  const settings = await (await page.request.get('/api/system-settings')).json() as { actionServerAllowlist: string[] };
  if (!settings.actionServerAllowlist.includes(BROKER)) {
    expect((await page.request.put('/api/system-settings', { data: {
      actionServerTrust: 'strict', actionServerAllowlist: [...settings.actionServerAllowlist, BROKER],
    } })).ok()).toBeTruthy();
  }
  await createWorkCenter(page, opts.childWc);
  for (const pkg of opts.childPackages) await load(page, pkg);
  await createWorkCenter(page, opts.parentWc);
  await load(page, opts.parentPackage);
  const p = await wcId(page, opts.parentWc);
  const c = await wcId(page, opts.childWc);
  expect((await page.request.put(`/api/work-centers/${p}/environment-bindings/e2e-dwm-env`, { data: { serverUri: BROKER } })).ok()).toBeTruthy();
  expect((await page.request.put(`/api/work-centers/${p}/control-grants/${c}`, { data: { scope: 'own' } })).ok()).toBeTruthy();
  return { p, c };
}

test('a workflow creates, waits for and reads another; another work center needs a grant', async ({ page, request }) => {
  await bootstrapFirstAdmin(request);
  await signIn(page, ADMIN.email, ADMIN.password);

  const settings = await (await page.request.get('/api/system-settings')).json() as { actionServerAllowlist: string[] };
  expect((await page.request.put('/api/system-settings', { data: {
    actionServerTrust: 'strict', actionServerAllowlist: [...settings.actionServerAllowlist, BROKER],
  } })).ok()).toBeTruthy();

  await createWorkCenter(page, 'E2E DWM B');
  await load(page, dwmChildWorkflowPackage({ localId: 'E2E DWM Child', oid: 'e2e-dwm-child-b' }));
  await createWorkCenter(page, 'E2E DWM A');
  await load(page, dwmChildWorkflowPackage({ localId: 'E2E DWM Child', oid: 'e2e-dwm-child' }));
  await load(page, dwmParentWorkflowPackage({ localId: 'E2E DWM Parent', oid: 'e2e-dwm-parent', childName: 'E2E DWM Child', workCenter: '' }));
  await load(page, dwmParentWorkflowPackage({ localId: 'E2E DWM Cross', oid: 'e2e-dwm-cross', childName: 'E2E DWM Child', workCenter: 'E2E DWM B' }));
  const a = await wcId(page, 'E2E DWM A');
  const b = await wcId(page, 'E2E DWM B');
  expect((await page.request.put(`/api/work-centers/${a}/environment-bindings/e2e-dwm-env`, { data: { serverUri: BROKER } })).ok()).toBeTruthy();

  // 1. Same work center: RW-1 creates RW-2, waits for it, reads its output.
  await createAndStart(page, 'E2E DWM Parent', 'RW-1');
  const parent = await historyDetail(page, a, 'RW-1');
  expect(parent.props['Made.Code']).toBe('0');
  expect(parent.props['Child.Label']).toBe('RW-2');
  expect(parent.props['ChildEnd.State']).toBe('Completed');
  expect(parent.props['ChildOut.Echo']).toBe('hello!');
  const child = await historyDetail(page, a, 'RW-2');
  expect(child.createdByLabel).toBe('E2E DWM A/RW-1');

  // 2. Another work center without a grant: refused with code 3.
  await createAndStart(page, 'E2E DWM Cross', 'RW-3');
  const refused = await historyDetail(page, a, 'RW-3');
  expect(refused.props['Made.Code']).toBe('3');

  // 3. With a grant it goes through.
  expect((await page.request.put(`/api/work-centers/${a}/control-grants/${b}`, { data: { scope: 'own' } })).ok()).toBeTruthy();
  await createAndStart(page, 'E2E DWM Cross', 'RW-4');
  const crossed = await historyDetail(page, a, 'RW-4');
  expect(crossed.props['Made.Code']).toBe('0');
  expect(crossed.props['ChildOut.Echo']).toBe('hello!');
});

// Spec 2026-10-19 §D.1: suspend, then unsuspend, a runtime in another work center.
test('a workflow suspends and unsuspends a runtime in another work center', async ({ page, request }) => {
  test.setTimeout(180_000);
  await bootstrapFirstAdmin(request);
  await signIn(page, ADMIN.email, ADMIN.password);
  const { p, c } = await setupPair(page, {
    parentWc: 'E2E DWM Sus P', childWc: 'E2E DWM Sus C',
    childPackages: [timedGateWorkflowPackage({ localId: 'E2E DWM Sus Child', oid: 'e2e-dwm-sus-child', delaySeconds: 20 })],
    parentPackage: dwmScriptedParentPackage({ localId: 'E2E DWM Sus Parent', oid: 'e2e-dwm-sus-parent', steps: [
      { kind: 'createStart', id: 'Create', workflow: 'E2E DWM Sus Child', workCenter: 'E2E DWM Sus C', into: 'Child' },
      { kind: 'hold', id: 'Hold1', seconds: 3 },
      { kind: 'verb', id: 'Suspend', action: 'Suspend Runtime Workflow', target: 'Child', into: 'Sus' },
      { kind: 'hold', id: 'Hold2', seconds: 15 },
      { kind: 'verb', id: 'Unsuspend', action: 'Unsuspend Runtime Workflow', target: 'Child', into: 'Unsus' },
      { kind: 'wait', id: 'Wait', target: 'Child', into: 'ChildEnd' },
    ] }),
  });

  await createAndStart(page, 'E2E DWM Sus Parent', 'RW-1');
  await expect.poll(() => liveStatus(page, c, 'RW-1').then((r) => r?.status), { timeout: 30_000 }).toBe('paused');

  await page.getByRole('button', { name: 'RW-1 details' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Open RW-1' })).toContainText('Paused');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect.poll(() => liveStatus(page, c, 'RW-1').then((r) => r?.status), { timeout: 30_000 }).toBe('running');

  const parent = await historyDetail(page, p, 'RW-1', 90_000);
  expect(parent.props['Sus.Code']).toBe('0');
  expect(parent.props['Unsus.Code']).toBe('0');
  expect(parent.props['ChildEnd.State']).toBe('Completed');
  expect((await historyDetail(page, c, 'RW-1')).finalState).toBe('completed');
});

// Spec 2026-10-19 §D.2 and §D.3: stop, and abort, a runtime in another work center.
for (const verb of [
  { name: 'stops', key: 'Stop', action: 'Stop Runtime Workflow', into: 'StopMade', finalState: 'stopped' },
  { name: 'aborts', key: 'Abort', action: 'Abort Runtime Workflow', into: 'AbortMade', finalState: 'aborted' },
] as const) {
  test(`a workflow ${verb.name} a running runtime in another work center`, async ({ page, request }) => {
    test.setTimeout(180_000);
    await bootstrapFirstAdmin(request);
    await signIn(page, ADMIN.email, ADMIN.password);
    const lower = verb.key.toLowerCase();
    const { p, c } = await setupPair(page, {
      parentWc: `E2E DWM ${verb.key} P`, childWc: `E2E DWM ${verb.key} C`,
      childPackages: [timedGateWorkflowPackage({ localId: `E2E DWM ${verb.key} Child`, oid: `e2e-dwm-${lower}-child`, delaySeconds: 600 })],
      parentPackage: dwmScriptedParentPackage({ localId: `E2E DWM ${verb.key} Parent`, oid: `e2e-dwm-${lower}-parent`, steps: [
        { kind: 'createStart', id: 'Create', workflow: `E2E DWM ${verb.key} Child`, workCenter: `E2E DWM ${verb.key} C`, into: 'Child' },
        { kind: 'hold', id: 'Hold', seconds: 3 },
        { kind: 'verb', id: verb.key, action: verb.action, target: 'Child', into: verb.into },
      ] }),
    });

    await createAndStart(page, `E2E DWM ${verb.key} Parent`, 'RW-1');
    const parent = await historyDetail(page, p, 'RW-1');
    expect(parent.props[`${verb.into}.Code`]).toBe('0');
    expect((await historyDetail(page, c, 'RW-1')).finalState).toBe(verb.finalState);
  });
}

// Spec 2026-10-19 §D.4 (and §A): the Created runtimes list, live and history rows, back link.
test('the parent lists the runtimes it created and opens each one', async ({ page, request }) => {
  test.setTimeout(180_000);
  await bootstrapFirstAdmin(request);
  await signIn(page, ADMIN.email, ADMIN.password);
  const { p, c } = await setupPair(page, {
    parentWc: 'E2E DWM Kids P', childWc: 'E2E DWM Kids C',
    childPackages: [
      dwmChildWorkflowPackage({ localId: 'E2E DWM Kid Quick', oid: 'e2e-dwm-kid-quick' }),
      timedGateWorkflowPackage({ localId: 'E2E DWM Kid Hold', oid: 'e2e-dwm-kid-hold', delaySeconds: 600 }),
    ],
    parentPackage: dwmScriptedParentPackage({ localId: 'E2E DWM Kids', oid: 'e2e-dwm-kids', steps: [
      { kind: 'createStart', id: 'Quick', workflow: 'E2E DWM Kid Quick', workCenter: 'E2E DWM Kids C', into: 'Quick' },
      { kind: 'createStart', id: 'Held', workflow: 'E2E DWM Kid Hold', workCenter: 'E2E DWM Kids C', into: 'Held' },
      { kind: 'hold', id: 'Hold', seconds: 600 },
    ] }),
  });

  await createAndStart(page, 'E2E DWM Kids', 'RW-1');
  await historyDetail(page, c, 'RW-1');
  await expect.poll(() => liveStatus(page, c, 'RW-2').then((r) => r?.status), { timeout: 30_000 }).toBe('running');
  const quick = await liveStatus(page, c, 'RW-1');
  expect(quick).toBeDefined();
  // With the live instance gone, Quick's row resolves to its history entry.
  expect((await page.request.delete(`/api/runtime-workflows/${quick!.id}`)).status()).toBe(204);

  await page.getByRole('button', { name: 'RW-1 details' }).click();
  const dialog = page.getByRole('dialog');
  const title = dialog.getByRole('heading', { level: 2 });
  await expect(dialog.getByRole('heading', { name: 'Created runtimes' })).toBeVisible();
  const held = dialog.getByRole('button', { name: 'Open RW-2' });
  await expect(held).toContainText('E2E DWM Kids C');
  await expect(held).toContainText('E2E DWM Kid Hold');
  await expect(held).toContainText('Started');
  await expect(held.locator('time')).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}T/);
  const quickRow = dialog.getByRole('button', { name: 'Open RW-1' });
  await expect(quickRow).toContainText('E2E DWM Kid Quick');
  await expect(quickRow).toContainText('Completed');

  await held.click();
  await expect(title).toContainText('RW-2');
  await dialog.getByRole('button', { name: 'Back to RW-1' }).click();
  await expect(title).toContainText('E2E DWM Kids');
  await dialog.getByRole('button', { name: 'Open RW-1' }).click();
  await expect(dialog.getByText('Details for a completed runtime workflow.')).toBeVisible();

  await page.keyboard.press('Escape');
  const parentRun = await liveStatus(page, p, 'RW-1');
  const heldRun = await liveStatus(page, c, 'RW-2');
  expect((await page.request.post(`/api/runtime-workflows/${parentRun!.id}/abort`)).ok()).toBeTruthy();
  expect((await page.request.post(`/api/runtime-workflows/${heldRun!.id}/abort`)).ok()).toBeTruthy();
});

// Spec 2026-10-19 §D.5 (and §C2): no time limit on the wait; the broker's token.
test('a wait with no time limit outlasts 30 s; the broker refuses calls without its token', async ({ page, request }) => {
  test.setTimeout(180_000);
  await bootstrapFirstAdmin(request);
  await signIn(page, ADMIN.email, ADMIN.password);
  const { p } = await setupPair(page, {
    parentWc: 'E2E DWM Long P', childWc: 'E2E DWM Long C',
    childPackages: [timedGateWorkflowPackage({ localId: 'E2E DWM Long Child', oid: 'e2e-dwm-long-child', delaySeconds: 35 })],
    parentPackage: dwmScriptedParentPackage({ localId: 'E2E DWM Long Parent', oid: 'e2e-dwm-long-parent', steps: [
      { kind: 'createStart', id: 'Create', workflow: 'E2E DWM Long Child', workCenter: 'E2E DWM Long C', into: 'Child' },
      { kind: 'wait', id: 'Wait', target: 'Child', into: 'ChildEnd' },
    ] }),
  });

  await createAndStart(page, 'E2E DWM Long Parent', 'RW-1');
  const parent = await historyDetail(page, p, 'RW-1', 120_000);
  expect(parent.finalState).toBe('completed');
  expect(parent.props['ChildEnd.State']).toBe('Completed');

  const refused = await request.get(`${BROKER}/trajectory/v1/capabilities`);
  expect(refused.status()).toBe(401);
  expect(await refused.json()).toEqual({ error: 'missing or wrong broker token' });
  const allowed = await request.get(`${BROKER}/trajectory/v1/capabilities`, { headers: { Authorization: `Bearer ${E2E_BROKER_TOKEN}` } });
  expect(allowed.status()).toBe(200);
  expect((await request.get(`${BROKER}/health`)).status()).toBe(200);
});
