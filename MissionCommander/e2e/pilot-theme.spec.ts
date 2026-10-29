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

// Pilot UX P2b (spec 2026-10-09 §18 E2E): an administrator saves a site theme in Commander;
// the Pilot already open on a work center picks it up over the SSE `theme` event — CSS, app
// title and tab title — without reloading. Then, with /api/theme unreachable, a reload keeps
// the cached theme. The suite's database is reset once for all specs, so the site theme is
// put back to the shipped defaults after every test (test.afterEach). P3a adds a work-center
// override that reaches only that work center's Pilots (spec §8.2).
// P3b: an uploaded site logo shows on the Pilot's login screen before sign-in (R5) and in the
// top bar after.
//
// createWorkCenter/assignStewardToWorkCenter: copied from pilot-frame.spec.ts (the suite
// copies helpers rather than importing them). Every Pilot locator uses exact names.
import { test, expect, type Page } from '@playwright/test';
import { bootstrapFirstAdmin, signIn } from './helpers/auth';
import { ADMIN, STEWARD } from './helpers/db';

const PILOT = 'http://localhost:3006';
const WC_NAME = 'E2E Theme WC';

const brand = (p: Page) =>
  p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--pilot-brand').trim());

async function createWorkCenter(page: Page, name: string) {
  await page.getByRole('button', { name: 'Work Centers' }).click(); // activity rail
  await page.getByRole('button', { name: 'New work center' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

async function assignStewardToWorkCenter(page: Page, wcName: string) {
  const wcs = (await (await page.request.get('/api/work-centers')).json()) as {
    nodes: Array<{ id: string; name: string }>;
  };
  const wc = wcs.nodes.find((w) => w.name === wcName);
  if (!wc) throw new Error(`assignStewardToWorkCenter: work center not found: ${wcName}`);
  const users = (await (await page.request.get('/api/users')).json()) as {
    users: Array<{ id: string; email: string }>;
  };
  const steward = users.users.find((u) => u.email === STEWARD.email);
  if (!steward) throw new Error('assignStewardToWorkCenter: STEWARD user not found');
  const assign = await page.request.post(`/api/work-centers/${wc.id}/users/${steward.id}`, { data: {} });
  expect(assign.ok()).toBeTruthy();
}

// The suite's database is reset once for all specs: put the shipped site theme back after
// every test here, even one that timed out (a `finally` inside the test body does not run
// once Playwright tears the test down). Best effort — a test that never signed in has
// nothing to reset.
test.afterEach(async ({ page }) => {
  await page.request.put('/api/system-settings', { data: { pilotTheme: { schema: 1 } } }).catch(() => {});
});

test('a Commander theme change reaches an open Pilot without reload, and survives an unreachable /api/theme', async ({ page, browser, request }) => {
  test.setTimeout(180_000);
  await bootstrapFirstAdmin(request);
  await signIn(page, ADMIN.email, ADMIN.password);
  await createWorkCenter(page, WC_NAME);
  await assignStewardToWorkCenter(page, WC_NAME);

  const operator = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const pilot = await operator.newPage();
  try {
    await pilot.goto(PILOT);
    await pilot.getByLabel('Email').fill(STEWARD.email);
    await pilot.getByLabel('Password').fill(STEWARD.password);
    await pilot.getByRole('button', { name: 'Sign In', exact: true }).click();
    await pilot.getByRole('button', { name: WC_NAME, exact: true }).click();
    await expect(pilot.getByRole('tab', { name: /^Inbox/ })).toBeVisible({ timeout: 30_000 });
    expect(await brand(pilot)).toBe('#1d4ed8');
    await pilot.evaluate(() => { (window as unknown as { __sameDocument?: boolean }).__sameDocument = true; });

    // Commander: Settings → Pilot branding. The preview reacts before anything is saved.
    await page.getByRole('button', { name: 'Settings' }).click(); // activity rail
    const branding = page.getByRole('region', { name: 'Pilot branding' });
    await branding.getByLabel('App title', { exact: true }).fill('Acme Pilot');
    await branding.getByLabel('Light Brand', { exact: true }).fill('#7c3aed');
    await expect(branding.getByRole('region', { name: 'Light preview' }).getByText('Claim', { exact: true }))
      .toHaveCSS('background-color', 'rgb(124, 58, 237)');
    await branding.getByRole('button', { name: 'Save Pilot branding', exact: true }).click();
    await expect(page.getByText('Pilot branding saved')).toBeVisible();

    // The open Pilot: NOTIFY → SSE `theme` → refetch → new CSS, app name and tab title.
    await expect.poll(() => brand(pilot), { timeout: 15_000 }).toBe('#7c3aed');
    await expect(pilot.getByRole('heading', { level: 1, name: 'Acme Pilot', exact: true })).toBeVisible();
    await expect(pilot).toHaveTitle('Inbox — Acme Pilot');
    expect(await pilot.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument)).toBe(true);

    // /api/theme unreachable: a reload keeps the cached theme (spec §18). A reload starts
    // at the work-center picker (the steward belongs to several), which uses the app title.
    await pilot.route('**/api/theme**', (route) => route.abort());
    await pilot.reload();
    await expect(pilot.getByRole('heading', { level: 1, name: 'Choose a work center' })).toBeVisible({ timeout: 30_000 });
    expect(await brand(pilot)).toBe('#7c3aed');
    await expect(pilot).toHaveTitle('Acme Pilot');
  } finally {
    await operator.close();
  }
});

test('a work-center override reaches the Pilot on that work center, and only there (spec §8.2)', async ({ page, browser, request }) => {
  test.setTimeout(180_000);
  const PLAIN = 'E2E Theme Plain WC';
  const BRANDED = 'E2E Theme Branded WC';
  await bootstrapFirstAdmin(request);
  await signIn(page, ADMIN.email, ADMIN.password);
  await createWorkCenter(page, PLAIN);
  await assignStewardToWorkCenter(page, PLAIN);
  await createWorkCenter(page, BRANDED); // leaves BRANDED selected
  await assignStewardToWorkCenter(page, BRANDED);

  await page.getByRole('tab', { name: 'Branding' }).click();
  const branding = page.getByRole('region', { name: 'Work-center branding' });
  await branding.getByLabel('App title', { exact: true }).fill('Branded Pilot');
  await branding.getByLabel('Light Brand', { exact: true }).fill('#15803d');
  await branding.getByRole('button', { name: 'Save work-center branding', exact: true }).click();
  await expect(page.getByText('Work-center branding saved')).toBeVisible();

  const operator = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const pilot = await operator.newPage();
  try {
    await pilot.goto(PILOT);
    await pilot.getByLabel('Email').fill(STEWARD.email);
    await pilot.getByLabel('Password').fill(STEWARD.password);
    await pilot.getByRole('button', { name: 'Sign In', exact: true }).click();
    await pilot.getByRole('button', { name: BRANDED, exact: true }).click();
    await expect(pilot.getByRole('tab', { name: /^Inbox/ })).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => brand(pilot), { timeout: 15_000 }).toBe('#15803d');
    await expect(pilot.getByRole('heading', { level: 1, name: 'Branded Pilot', exact: true })).toBeVisible();

    // The work center next door keeps the site theme.
    await pilot.locator('.wc-switch').click();
    await pilot.getByRole('dialog', { name: 'Switch work center' }).getByRole('button', { name: PLAIN, exact: true }).click();
    await expect.poll(() => brand(pilot), { timeout: 15_000 }).toBe('#1d4ed8');
    await expect(pilot.getByRole('heading', { level: 1, name: 'Mission Pilot', exact: true })).toBeVisible();
  } finally {
    await operator.close();
  }
});

test('the login screen shows the site logo (spec §12, R5), and the top bar shows it after sign-in', async ({ page, browser, request }) => {
  test.setTimeout(180_000);
  const WC = 'E2E Logo WC';
  const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><rect width="120" height="40" fill="#7c3aed"/></svg>';
  await bootstrapFirstAdmin(request);
  await signIn(page, ADMIN.email, ADMIN.password);
  await createWorkCenter(page, WC);
  await assignStewardToWorkCenter(page, WC);

  // Commander: upload, describe, see it in the preview, save.
  await page.getByRole('button', { name: 'Settings' }).click(); // activity rail
  const branding = page.getByRole('region', { name: 'Pilot branding' });
  // The editor loads the stored theme first; until then its fields are disabled (and it
  // re-mounts once loaded), so a file chosen earlier would be dropped.
  const uploadLogo = branding.getByLabel('Upload logo', { exact: true });
  await expect(uploadLogo).toBeEnabled();
  await uploadLogo
    .setInputFiles({ name: 'acme.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(SVG) });
  await branding.getByLabel('Logo description', { exact: true }).fill('Acme logo');
  await expect(branding.getByRole('region', { name: 'Light preview' }).getByRole('img', { name: 'Acme logo' })).toBeVisible();
  await branding.getByRole('button', { name: 'Save Pilot branding', exact: true }).click();
  await expect(page.getByText('Pilot branding saved')).toBeVisible();

  const operator = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const pilot = await operator.newPage();
  try {
    // Signed out: the site theme is public, so the login screen is branded.
    await pilot.goto(PILOT);
    const loginLogo = pilot.getByRole('img', { name: 'Acme logo' });
    await expect(loginLogo).toBeVisible({ timeout: 15_000 });
    await expect(loginLogo).toHaveClass(/login-logo/);
    const src = await loginLogo.getAttribute('src');
    expect(src).toMatch(/^\/api\/brand\/sha256:[0-9a-f]{64}$/);
    // Served by the engine, not just referenced: the image decoded.
    await expect.poll(() => loginLogo.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

    await pilot.getByLabel('Email').fill(STEWARD.email);
    await pilot.getByLabel('Password').fill(STEWARD.password);
    await pilot.getByRole('button', { name: 'Sign In', exact: true }).click();
    await pilot.getByRole('button', { name: WC, exact: true }).click();
    await expect(pilot.getByRole('tab', { name: /^Inbox/ })).toBeVisible({ timeout: 30_000 });
    await expect(pilot.locator('.top-logo')).toHaveAttribute('src', src!);
  } finally {
    await operator.close();
  }
});
