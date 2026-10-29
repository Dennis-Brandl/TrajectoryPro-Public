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

import { test, expect } from '@playwright/test'
import { ADMIN_CREDENTIALS } from './helpers/session'

// auth.spec drives the REAL login flow, so each test must START unauthenticated —
// it deliberately does NOT load the admin storageState. The e2e DB is already
// setup-complete (global-setup bootstrapped the admin + marked setup), so /login
// renders the sign-in form (no /setup redirect) and the bootstrapped admin
// credentials are valid. There is no Register UI in this model.
test.describe('Authentication', () => {
  test('unauthenticated visit to the app redirects to /login', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible({ timeout: 10_000 })
  })

  test('login with the bootstrapped admin credentials lands in the app', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email').fill(ADMIN_CREDENTIALS.email)
    await page.getByLabel('Password').fill(ADMIN_CREDENTIALS.password)
    await page.getByRole('button', { name: 'Sign In' }).click()
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible({ timeout: 15_000 })
    await expect(page).toHaveURL('/')
  })

  test('shows an error for invalid credentials', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email').fill(ADMIN_CREDENTIALS.email)
    await page.getByLabel('Password').fill('WrongPassword123!')
    await page.getByRole('button', { name: 'Sign In' }).click()
    // Stays on /login and surfaces the better-auth error in the form's alert box.
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByTestId('login-error')).toBeVisible({ timeout: 10_000 })
  })

  test('logout returns to the login page', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email').fill(ADMIN_CREDENTIALS.email)
    await page.getByLabel('Password').fill(ADMIN_CREDENTIALS.password)
    await page.getByRole('button', { name: 'Sign In' }).click()
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 })
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible()
  })

  test('validates email format on the login form', async ({ page }) => {
    await page.goto('/login')
    const email = page.getByLabel('Email')
    await email.fill('not-an-email')
    await page.getByLabel('Password').fill('ValidPass123!')
    await page.getByRole('button', { name: 'Sign In' }).click()
    // Native type="email" constraint validation rejects the malformed address and
    // blocks submit — the field reports a typeMismatch and we stay on /login.
    await expect(email).toHaveJSProperty('validity.valid', false)
    await expect(email).toHaveJSProperty('validity.typeMismatch', true)
    await expect(page).toHaveURL(/\/login/)
  })

  test('validates minimum password length on the login form', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email').fill(ADMIN_CREDENTIALS.email)
    await page.getByLabel('Password').fill('short')
    await page.getByRole('button', { name: 'Sign In' }).click()
    await expect(page.getByText('Password must be at least 8 characters')).toBeVisible({ timeout: 8_000 })
    await expect(page).toHaveURL(/\/login/)
  })

  test('visiting /setup when setup is complete redirects away from the wizard', async ({ page }) => {
    // setup-complete → /setup redirects to / → (unauthenticated) → /login.
    await page.goto('/setup')
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 })
  })
})
