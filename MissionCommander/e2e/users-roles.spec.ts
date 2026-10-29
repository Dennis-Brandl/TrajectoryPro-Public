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
// M2 e2e (Plan 2): admin issues a login, assigns a role, the user signs in; admin resets
// the password (old fails, new works); admin impersonates the viewer and stops. Drives the
// REAL server against the disposable e2e Postgres (see e2e/reset-db.mjs). One file,
// workers:1 + fullyParallel:false → deterministic declaration order; each leg depends on
// the prior (the created login persists across legs within the shared database).
import { test, expect, type Page } from '@playwright/test';
import { bootstrapFirstAdmin, signIn } from './helpers/auth';
import { ADMIN, NEW_USER } from './helpers/db';

async function signOut(page: Page) {
  await page.getByRole('button', { name: /sign out/i }).click();
  await expect(page.getByLabel('Email')).toBeVisible({ timeout: 15_000 });
}

test('admin creates a viewer login and assigns roles on a work center; the new user can sign in', async ({ page, request }) => {
  await bootstrapFirstAdmin(request);
  await signIn(page, ADMIN.email, ADMIN.password);

  // Users hierarchy → create the login (spec 2026-09-06 D6: login name is required).
  await page.getByRole('button', { name: 'Users' }).click();
  await page.getByRole('button', { name: 'New user' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Email').fill(NEW_USER.email);
  await dialog.getByLabel('Display name').fill(NEW_USER.displayName);
  await dialog.getByLabel('Login name').fill(NEW_USER.loginName);
  await dialog.getByLabel('Initial password').fill(NEW_USER.password);
  // accessLevel defaults to viewer — leave it.
  await dialog.getByRole('button', { name: 'Create user' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { name: NEW_USER.displayName })).toBeVisible();
  await expect(page.getByText(`${NEW_USER.email} · ${NEW_USER.loginName}`)).toBeVisible();

  // Roles are per work center (spec 2026-09-06 D3): assign the user to the seeded "Demo Line"
  // work center from its Users tab, then edit their roles there. The demo seed GUARANTEES the
  // "Operator"/"Supervisor" roles exist, so this leg is non-tolerant.
  await page.getByRole('button', { name: 'Work Centers' }).click();
  await page.getByRole('button', { name: 'Demo Line', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Demo Line' })).toBeVisible();
  await page.getByRole('tab', { name: 'Users' }).click();
  await page.getByRole('button', { name: 'Add user' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByPlaceholder('Search…').fill(NEW_USER.displayName);
  await dialog.getByRole('button', { name: 'Link' }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole('button', { name: `Edit roles for ${NEW_USER.displayName}` }).click();
  const roleDialog = page.getByRole('dialog');
  await expect(roleDialog).toBeVisible();
  await roleDialog.getByRole('checkbox', { name: 'Operator' }).check();
  await roleDialog.getByRole('checkbox', { name: 'Supervisor' }).check();
  await roleDialog.getByRole('button', { name: 'Save' }).click();
  await expect(roleDialog).toBeHidden();
  // The Roles cell renders from the SERVER-returned WorkCenterView, so its text is real
  // evidence both assignments reached the database and came back.
  await expect(page.getByRole('cell', { name: /Operator, Supervisor/ })).toBeVisible();

  // The user's own detail mirrors it, grouped by work center.
  await page.getByRole('button', { name: 'Users' }).click();
  await page.getByRole('button', { name: NEW_USER.displayName }).click();
  // exact: the Roles cell's accessible name now carries "Add Role in Demo Line" too.
  await expect(page.getByRole('cell', { name: 'Demo Line', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Operator, Supervisor' })).toBeVisible();

  // 2026-09-09: roles are also edited from the user's side, one work center per row — the
  // row's "Add Role" opens the same per-work-center dialog (same route, same right). Drop
  // Supervisor here and read the row back from the SERVER-returned work-center view.
  await page.getByRole('button', { name: 'Add Role in Demo Line' }).click();
  const userRoleDialog = page.getByRole('dialog');
  await expect(userRoleDialog).toBeVisible();
  await expect(userRoleDialog.getByText('Roles this member holds in Demo Line.')).toBeVisible();
  await userRoleDialog.getByRole('checkbox', { name: 'Supervisor' }).uncheck();
  await userRoleDialog.getByRole('button', { name: 'Save' }).click();
  await expect(userRoleDialog).toBeHidden();
  const demoRow = page.getByRole('row', { name: /Demo Line/ });
  await expect(demoRow).toContainText('Operator');
  await expect(demoRow).not.toContainText('Supervisor');

  await signOut(page);

  // The new user signs in with the initial password and sees a viewer-scoped tool.
  await signIn(page, NEW_USER.email, NEW_USER.password);
  await page.getByRole('button', { name: 'Users' }).click();
  await expect(page.getByRole('button', { name: 'New user' })).toBeDisabled();
  await signOut(page);
});

test('admin resets the new user password: old fails, new works', async ({ page }) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.getByRole('button', { name: 'Users' }).click();
  await page.getByRole('button', { name: NEW_USER.displayName }).click();
  await page.getByRole('button', { name: 'Set password' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('New password').fill(NEW_USER.newPassword);
  await dialog.getByLabel('Confirm password').fill(NEW_USER.newPassword);
  await dialog.getByRole('button', { name: 'Set password' }).click();
  await expect(dialog).toBeHidden();
  await signOut(page);

  // Old password now fails. Anchor on a TRUTHY failure signal FIRST: LoginPage surfaces a
  // failed sign-in in <p role="alert" data-testid="login-error"> (src/routes/login.tsx),
  // so waiting for that element forces the auth round-trip to actually resolve as a
  // failure — a bare toHaveCount(0) on "Sign out" would pass vacuously before auth even
  // resolves (Sign out is absent on the login screen regardless).
  await page.goto('/login');
  await page.getByLabel('Email').fill(NEW_USER.email);
  await page.getByLabel('Password').fill(NEW_USER.password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page.getByTestId('login-error')).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('button', { name: /sign out/i })).toHaveCount(0);

  // New password works.
  await signIn(page, NEW_USER.email, NEW_USER.newPassword);
  await signOut(page);
});

test('admin impersonates the viewer, sees the banner and viewer rights, then stops', async ({ page }) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.getByRole('button', { name: 'Users' }).click();
  await page.getByRole('button', { name: NEW_USER.displayName }).click();
  await page.getByRole('button', { name: 'Impersonate' }).click();

  // Banner appears; the tool is now viewer-scoped (New user disabled).
  await expect(page.getByText(/Impersonating/)).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Users' }).click();
  await expect(page.getByRole('button', { name: 'New user' })).toBeDisabled();

  // Stop restores the admin (banner gone, New user enabled again).
  await page.getByRole('button', { name: /stop impersonating/i }).click();
  await expect(page.getByText(/Impersonating/)).toHaveCount(0, { timeout: 15_000 });
  await page.getByRole('button', { name: 'Users' }).click();
  await expect(page.getByRole('button', { name: 'New user' })).toBeEnabled();
});
