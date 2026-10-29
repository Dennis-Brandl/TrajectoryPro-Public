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
// Runtime-workflow e2e (runtime-workflow-creation plan, Task 10): drives the REAL server
// against the disposable e2e Postgres (see e2e/reset-db.mjs), same harness as every other
// spec in this directory. Two legs in one file — workers:1 + fullyParallel:false
// (playwright.config.ts) gives them a deterministic declaration-order run, and the second
// leg deliberately DEPENDS on state the first leg left behind (its work center, its loaded
// workflow, and RW-1's row) rather than re-creating it — mirroring golden-path.spec.ts's own
// two-leg admin-then-viewer pattern ("the admin test always runs before the viewer test").
//
// createWorkCenter/load below reproduce artifacts-load.spec.ts's own local helpers (not
// exported there, so not importable); selectWorkCenter is this file's own addition for
// re-entering a work center created earlier in the run.
//
// Task 20: playwright.config.ts's third webServer entry now boots a live Mission Engine
// against this same e2e database, so RW-1 (built from machineWorkflowPackage(), a genuinely
// executable START->END workflow — see mission-engine.spec.ts for the dedicated engine-
// execution leg) actually runs once Started, rather than sitting 'queued' forever the way it
// did before the engine was wired in.
import { test, expect, type Page } from '@playwright/test';
import { bootstrapFirstAdmin, signIn } from './helpers/auth';
import { ADMIN } from './helpers/db';
import { machineWorkflowPackage, type FilePayload } from './helpers/packages';

const WC_NAME = 'E2E Runtime WC';
const WF_NAME = 'E2E Runtime Workflow';

// Minted by this spec, not seeded — distinct from helpers/db.ts's NEW_USER (users-roles.
// spec.ts's own fixture) so the two files never collide in the shared e2e database.
const RW_VIEWER = {
  email: 'e2e-rw-viewer@command.local',
  password: 'e2e-rw-viewer-pw-1',
  displayName: 'E2E RW Viewer',
  loginName: 'e2e-rw-viewer',
};

async function createWorkCenter(page: Page, name: string) {
  await page.getByRole('button', { name: 'Work Centers' }).click(); // activity rail
  await page.getByRole('button', { name: 'New work center' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toBeHidden();
  // HierarchyPane's onSaved selects the new node.
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

// Re-enters a work center created earlier in the run. WorkCenterTree.tsx's row-select button
// carries no aria-label — its accessible name is just node.name — so `exact: true` is
// load-bearing: without it this would also match "New child of {name}"/"Expand {name}".
async function selectWorkCenter(page: Page, name: string) {
  await page.getByRole('button', { name: 'Work Centers' }).click(); // activity rail
  await page.getByRole('button', { name, exact: true }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

async function load(page: Page, file: FilePayload) {
  await page.getByRole('button', { name: /Load packages/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Packages').setInputFiles([file]);
  await dialog.getByRole('button', { name: 'Load', exact: true }).click();
  // The results dialog replaces the load dialog.
  await expect(page.getByText('Load results')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();
}

async function signOut(page: Page) {
  await page.getByRole('button', { name: /sign out/i }).click();
  await expect(page.getByLabel('Email')).toBeVisible({ timeout: 15_000 });
}

// Phase 6 (Task 12): the Runtime tab is now filter chips -> presence strip -> card grid ->
// pagination, and ALL controls (Start/Delete/etc.) live in the per-card detail dialog (D4).
// RuntimeTab resets to its default 'active' filter chip every time it remounts (Radix's
// TabsContent unmounts inactive tabs by default, so switching to another tab and back to
// Runtime is a fresh mount) — the 'All' chip must be re-clicked on every visit that needs to
// see a 'pending' row, or (below) a row whose settled status is ambiguous between the active
// and finished buckets.
//
// cardStatusText replaces the old row-based status/status-cell reads: the badge now lives on
// the card (RuntimeCard.tsx renders exactly one `span[title]`), read via the grid's own
// "Refresh" button (RuntimeTab only refetches on an explicit refresh() call) — so the dialog
// must be closed (Escape) before calling this.
async function cardStatusText(page: Page, n: number): Promise<string> {
  await page.getByRole('button', { name: 'Refresh' }).click();
  // The overlay button (D4) is empty; the badge lives in its parent card div.
  const card = page.getByRole('button', { name: `RW-${n} details` }).locator('..');
  return ((await card.locator('span[title]').first().textContent()) ?? '').trim();
}

test('an admin creates, starts, and deletes runtime workflows (bypassing the Mission System Commander flag by design)', async ({ page, request }) => {
  await bootstrapFirstAdmin(request);
  await signIn(page, ADMIN.email, ADMIN.password);
  await createWorkCenter(page, WC_NAME);
  // Declares one literal starting parameter so this leg exercises the parameter-entry dialog
  // branch (CreateRuntimeWorkflowDialog.tsx's specs.length > 0 path) — the bare
  // machineWorkflowPackage() default (no starting_parameter_specifications) only ever hits the
  // no-params branch. Task 20: machineWorkflowPackage() (START->END, machine-executable), NOT
  // the plain workflowPackage() this leg used before — a live Mission Engine now shares this
  // e2e database (playwright.config.ts's third webServer entry), so RW-1's Start click below
  // actually gets picked up and run; workflowPackage()'s single bare START step would fail the
  // engine's own validation (NO_END_STEP) and settle 'errored' instead.
  await load(page, machineWorkflowPackage({
    localId: WF_NAME, oid: 'e2e-rw-1',
    startingParameterSpecifications: [{ id: 'BatchSize', default_value: '10', value_type: 'literal' }],
  }));

  // Runtime tab starts empty (RuntimeTab.tsx's lazy fetch fires once this TabsContent mounts).
  await page.getByRole('tab', { name: 'Runtime' }).click();
  await expect(page.getByText('No runtime workflows')).toBeVisible();

  // The create entry point lives on the Workflows tab's per-row action (WorkCenterDetail.tsx
  // WorkflowsTab). Its accessible name comes from an aria-label, NOT its visible
  // "Create Runtime Workflow…" text, which the row's "Roles for {name}" button would
  // otherwise also risk colliding with under substring matching.
  await page.getByRole('tab', { name: 'Workflows' }).click();
  await page.getByRole('button', { name: `Create runtime workflow from ${WF_NAME}` }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Create Runtime Workflow' })).toBeVisible();
  // The fixture package now declares one literal starting parameter (BatchSize, default 10),
  // so this is the parameter-entry path (CreateRuntimeWorkflowDialog.tsx's specs.length > 0
  // branch): the input prefills the literal default, then gets edited before Create.
  const batchSize = dialog.getByLabel('BatchSize');
  await expect(batchSize).toHaveValue('10');
  await batchSize.fill('25');
  await dialog.getByRole('button', { name: 'Create and Wait', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('RW-1 created — Waiting')).toBeVisible();

  // RW-1 is 'pending' — hidden by the default Active chip.
  await page.getByRole('tab', { name: 'Runtime' }).click();
  await page.getByRole('button', { name: 'All' }).click();
  await expect(page.getByRole('button', { name: 'RW-1 details' })).toBeVisible();
  expect(await cardStatusText(page, 1)).toBe('Waiting');

  // Start via the detail dialog (D4: controls live there now, not on the card face).
  await page.getByRole('button', { name: 'RW-1 details' }).click();
  const detailDialog = page.getByRole('dialog');
  await page.getByRole('button', { name: 'Start RW-1' }).click();
  // Final-review fix wave: the engine's schema validator now compiles its ajv validator once
  // per process (memoized) instead of once per acquire — mission-engine.spec.ts's own leg runs
  // earlier in this file's declaration order and already warms that cache, so by the time this
  // click lands, RW-1's trivial START->END workflow can complete its WHOLE acquire+start+drain
  // cycle (one atomic transaction, instance.ts) before this refresh even lands — 'queued'/
  // "Starting" is no longer guaranteed externally observable here, exactly the same caveat this
  // test already documents (a few lines below) for 'running'/"Started". Assert the weaker,
  // still-meaningful invariant: RW-1 left 'pending', to whatever it became next (read off the
  // dialog's own title badge — the dialog polls every 2 s and is still open here).
  await expect(detailDialog.getByText(/^(Starting|Started|Completed)$/)).toBeVisible();
  // Once queued, RW-1 can't be started again — Start stays disabled for the rest of this
  // leg no matter what status the engine takes it to next.
  await expect(page.getByRole('button', { name: 'Start RW-1' })).toBeDisabled();
  await page.keyboard.press('Escape'); // close the dialog; the grid keeps polling

  // Task 20: a live engine now shares this e2e database, and WF_NAME (machineWorkflowPackage())
  // is genuinely executable, so RW-1 no longer sits 'queued'/Starting forever the way it did
  // before the engine was wired in. Loosened from the old "stays Starting, Delete stays
  // disabled forever" assertion to: poll (via cardStatusText's own "Refresh" click) until
  // status leaves Starting. A trivial START->END workflow settles inside ONE atomic
  // acquire+start transaction (instance.ts), so 'running'/"Started" is never externally
  // observable here — only 'completed'/"Completed" is — but the poll tolerates either.
  await expect.poll(async () => cardStatusText(page, 1), { timeout: 30_000 }).toMatch(/Started|Completed/);

  // 'completed' is in RUNTIME_DELETABLE (runtime-status.ts), unlike 'queued' — Delete is now
  // enabled rather than disabled, the opposite of the pre-engine assertion this replaces.
  await page.getByRole('button', { name: 'RW-1 details' }).click();
  await expect(page.getByRole('button', { name: 'Delete RW-1' })).toBeEnabled();
  await page.keyboard.press('Escape');

  // A second runtime workflow off the same master — created, then deleted while still
  // pending (RUNTIME_DELETABLE includes 'pending'), proving delete really removes a row.
  await page.getByRole('tab', { name: 'Workflows' }).click();
  await page.getByRole('button', { name: `Create runtime workflow from ${WF_NAME}` }).click();
  await expect(dialog).toBeVisible();
  // Same workflow, same declared parameter — accept the prefilled default this time.
  await expect(dialog.getByLabel('BatchSize')).toHaveValue('10');
  await dialog.getByRole('button', { name: 'Create and Wait', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('RW-2 created — Waiting')).toBeVisible();

  // RW-2 is 'pending' too — All chip again (fresh RuntimeTab mount).
  await page.getByRole('tab', { name: 'Runtime' }).click();
  await page.getByRole('button', { name: 'All' }).click();
  await expect(page.getByRole('button', { name: 'RW-2 details' })).toBeVisible();
  await page.getByRole('button', { name: 'RW-2 details' }).click();
  await page.getByRole('button', { name: 'Delete RW-2' }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  // The dialog's delete path closes without refreshing the grid — force a refresh
  // (matching cardStatusText's own pattern) instead of racing the 5s poll tick.
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByRole('button', { name: 'RW-2 details' })).toHaveCount(0);
  // RW-1 — Started/Completed by the engine above — is untouched by RW-2's delete.
  await expect(page.getByRole('button', { name: 'RW-1 details' })).toBeVisible();
});

test('a non-commander sees runtime workflows read-only', async ({ page, request }) => {
  await bootstrapFirstAdmin(request);
  await signIn(page, ADMIN.email, ADMIN.password);

  // Create the viewer login (Users hierarchy → New user; mirrors users-roles.spec.ts).
  // accessLevel defaults to viewer — leave it; missionSystemCommander is a per-work-center flag
  // orthogonal to access tier, which is exactly the distinction this leg exercises.
  await page.getByRole('button', { name: 'Users' }).click();
  await page.getByRole('button', { name: 'New user' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Email').fill(RW_VIEWER.email);
  await dialog.getByLabel('Display name').fill(RW_VIEWER.displayName);
  await dialog.getByLabel('Login name').fill(RW_VIEWER.loginName);
  await dialog.getByLabel('Initial password').fill(RW_VIEWER.password);
  await dialog.getByRole('button', { name: 'Create user' }).click();
  await expect(dialog).toBeHidden();

  // Assign to the work center the commander leg left behind, WITHOUT the commander flag —
  // the Users-tab picker (LinkPickerModal) only ever links; the separate "Mission Commander
  // for {displayName}" checkbox (WorkCenterDetail.tsx UsersTab) is never touched here.
  await selectWorkCenter(page, WC_NAME);
  await page.getByRole('tab', { name: 'Users' }).click();
  await page.getByRole('button', { name: 'Add user' }).click();
  await expect(dialog).toBeVisible();
  // Narrows the picker to exactly this user before clicking its row's action button, so a
  // bare unscoped "Link" click can't hit some other listed user first.
  await dialog.getByPlaceholder('Search…').fill(RW_VIEWER.displayName);
  await dialog.getByRole('button', { name: 'Link' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Assigned')).toBeVisible();

  await signOut(page);
  await signIn(page, RW_VIEWER.email, RW_VIEWER.password);
  await selectWorkCenter(page, WC_NAME);

  // Runtime tab renders the commander leg's card (RW-1, Started/Completed by the live engine
  // by now — Task 20; status is ambiguous between the two, so the All chip is needed to
  // guarantee visibility regardless of which bucket it settled into) — monitoring is
  // deliberately open to every access tier (spec §6.2) — but every control in its detail
  // dialog (D4: controls live there now, not on the card face) is disabled for a
  // non-commander. Delete stays disabled here regardless of RW-1's actual status:
  // RuntimeDetailDialog.tsx's disabled condition is `!canCommand || !a.enabled || busy` for
  // every action, and `!canCommand` alone already forces it for this viewer.
  await page.getByRole('tab', { name: 'Runtime' }).click();
  await page.getByRole('button', { name: 'All' }).click();
  await expect(page.getByRole('button', { name: 'RW-1 details' })).toBeVisible();
  await page.getByRole('button', { name: 'RW-1 details' }).click();
  await expect(page.getByRole('button', { name: 'Start RW-1' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Delete RW-1' })).toBeDisabled();
  await page.keyboard.press('Escape');

  // …and the create entry point on the Workflows tab is disabled too.
  await page.getByRole('tab', { name: 'Workflows' }).click();
  await expect(page.getByRole('button', { name: `Create runtime workflow from ${WF_NAME}` })).toBeDisabled();
});
