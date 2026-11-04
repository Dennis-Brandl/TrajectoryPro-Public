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
import { ADMIN_STORAGE_STATE } from './helpers/session'

/**
 * The suite frame at a narrow window: with a workflow open, the fixed header group stays
 * on screen and the page has no sideways scroll. The header tools shrink instead.
 */
test.describe('Suite frame', () => {
  test.use({ storageState: ADMIN_STORAGE_STATE })

  test('keeps the fixed header group visible at 1024px with a workflow open', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 })
    // Worst case: an email-length user name in the header.
    await page.route('**/api/auth/get-session*', async (route) => {
      const response = await route.fetch()
      const body = await response.json()
      if (body?.user) body.user.name = 'a.very.long.operator.name@example-company.com'
      await route.fulfill({ response, json: body })
    })
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Workflows', exact: true })).toBeVisible({ timeout: 15_000 })

    const libraryName = `Frame Library ${Date.now()}`
    await page.getByRole('button', { name: 'New Library' }).click()
    await page.getByRole('alertdialog').getByRole('textbox').fill(libraryName)
    await page.getByRole('button', { name: 'Create' }).click()
    await expect(page.getByText(libraryName).first()).toBeVisible({ timeout: 8_000 })

    const libraryRow = page.getByText(libraryName).first().locator('..')
    await libraryRow.hover()
    await libraryRow.locator('button').filter({ hasText: '' }).last().click()
    await page.getByRole('menuitem', { name: 'Add Workflow' }).click()
    const specName = `Frame Workflow ${Date.now()}`
    await page.getByRole('alertdialog').getByRole('textbox').fill(specName)
    await page.getByRole('button', { name: 'Create' }).click()
    await expect(page.getByText(specName).first()).toBeVisible({ timeout: 8_000 })
    await page.getByText(specName).first().click()
    await expect(page.locator('.react-flow')).toBeVisible({ timeout: 8_000 })

    for (const name of ['Sign out', 'Help', 'Settings']) {
      const box = await page.getByRole(name === 'Help' ? 'link' : 'button', { name }).boundingBox()
      expect(box, name).not.toBeNull()
      expect(box!.x, name).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width, name).toBeLessThanOrEqual(1024)
    }
    const tools = await page.getByTestId('header-tools').boundingBox()
    const layout = await page.getByRole('button', { name: 'Auto-layout' }).boundingBox()
    expect(tools).not.toBeNull()
    expect(layout).not.toBeNull()
    expect(layout!.x).toBeGreaterThanOrEqual(tools!.x)
    expect(layout!.x + layout!.width).toBeLessThanOrEqual(tools!.x + tools!.width + 0.5)
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    expect(scrollWidth).toBeLessThanOrEqual(1024)
  })
})
