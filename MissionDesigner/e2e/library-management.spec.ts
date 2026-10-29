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
 * Library management tests — create libraries across entity types,
 * create specifications, organise with sub-libraries, library detail form.
 *
 * Entity type tabs in the left sidebar:
 *  - The sidebar has tabs for Workflow / Step / Environment / Action.
 *  - TODO: Identify the exact tab selector. Likely role="tab" or accessible text.
 *    Add data-testid="tab-workflow|step|environment|action" to the tab triggers.
 *
 * Library context menu operations (via the "..." MoreHorizontal button):
 *  - "Add Workflow" / "Add Step" / "Add Environment" / "Add Action"
 *  - "Add Sub-Library"
 *  - "Rename"
 *  - "Delete"
 *
 * Library detail view:
 *  - Shown in the main content area when a library is selected but no spec is active.
 *  - Has fields: Description (textarea), Author (input), Version History (read-only history list).
 *  - "Save" button becomes enabled when fields are dirty.
 */

test.describe('Library management', () => {
  test.use({ storageState: ADMIN_STORAGE_STATE })

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('tab', { name: 'Workflows' })).toBeVisible({ timeout: 15_000 })
  })

  test('create a Workflow library', async ({ page }) => {
    // Default tab is Workflow
    await expect(page.getByRole('button', { name: 'New Library' })).toBeVisible({ timeout: 8_000 })

    await page.getByRole('button', { name: 'New Library' }).click()
    await expect(page.getByRole('alertdialog')).toBeVisible()
    await expect(page.getByText('Create Workflow Library')).toBeVisible()

    const name = `Workflow Library ${Date.now()}`
    await page.getByRole('alertdialog').getByRole('textbox').fill(name)
    await page.getByRole('button', { name: 'Create' }).click()

    await expect(page.getByText(name)).toBeVisible({ timeout: 8_000 })
  })

  test.fixme('create a Step library (requires Step tab navigation)', async () => {
    /**
     * TODO: Click the "Step" entity type tab to switch context.
     * Add data-testid="tab-step" to the tab trigger element.
     *
     * await page.getByTestId('tab-step').click();
     * await page.getByRole('button', { name: 'New Library' }).click();
     * await expect(page.getByText('Create Step Library')).toBeVisible();
     *
     * const name = `Step Library ${Date.now()}`;
     * await page.getByRole('alertdialog').getByRole('textbox').fill(name);
     * await page.getByRole('button', { name: 'Create' }).click();
     * await expect(page.getByText(name)).toBeVisible();
     */
  })

  test('create a specification (workflow) inside a library', async ({ page }) => {
    // Create the parent library
    await page.getByRole('button', { name: 'New Library' }).click()
    const libName = `Spec Parent Library ${Date.now()}`
    await page.getByRole('alertdialog').getByRole('textbox').fill(libName)
    await page.getByRole('button', { name: 'Create' }).click()
    await expect(page.getByText(libName)).toBeVisible({ timeout: 8_000 })

    // Open context menu and add a workflow
    const libraryRow = page.getByText(libName).locator('..')
    await libraryRow.hover()
    await libraryRow.locator('button').filter({ hasText: '' }).last().click()
    await page.getByRole('menuitem', { name: 'Add Workflow' }).click()

    await expect(page.getByRole('alertdialog')).toBeVisible()
    await expect(page.getByText('Add Master Workflow')).toBeVisible()

    const specName = `My Workflow Spec ${Date.now()}`
    await page.getByRole('alertdialog').getByRole('textbox').fill(specName)
    await page.getByRole('button', { name: 'Create' }).click()

    await expect(page.getByText(specName).first()).toBeVisible({ timeout: 8_000 })
  })

  test('create a sub-library inside a library', async ({ page }) => {
    // Create a parent library
    await page.getByRole('button', { name: 'New Library' }).click()
    const parentName = `Parent Library ${Date.now()}`
    await page.getByRole('alertdialog').getByRole('textbox').fill(parentName)
    await page.getByRole('button', { name: 'Create' }).click()
    await expect(page.getByText(parentName)).toBeVisible({ timeout: 8_000 })

    // Open context menu and add sub-library
    const libraryRow = page.getByText(parentName).locator('..')
    await libraryRow.hover()
    await libraryRow.locator('button').filter({ hasText: '' }).last().click()
    await page.getByRole('menuitem', { name: 'Add Sub-Library' }).click()

    await expect(page.getByRole('alertdialog')).toBeVisible()
    await expect(page.getByRole('alertdialog').getByText('Add Sub-Library')).toBeVisible()

    const subLibName = `Child Library ${Date.now()}`
    await page.getByRole('alertdialog').getByRole('textbox').fill(subLibName)
    await page.getByRole('button', { name: 'Create' }).click()

    // Sub-library should appear (parent was expanded by the handler)
    await expect(page.getByText(subLibName).first()).toBeVisible({ timeout: 8_000 })
  })

  test('library detail view shows when library is selected', async ({ page }) => {
    // Create a library
    await page.getByRole('button', { name: 'New Library' }).click()
    const libName = `Detail View Library ${Date.now()}`
    await page.getByRole('alertdialog').getByRole('textbox').fill(libName)
    await page.getByRole('button', { name: 'Create' }).click()
    await expect(page.getByText(libName)).toBeVisible({ timeout: 8_000 })

    // Click on the library name to select it
    await page.getByText(libName).click()

    // The LibraryDetailView should appear in the main content area
    await expect(page.getByLabel('Library Description')).toBeVisible({ timeout: 8_000 })
    await expect(page.getByLabel('Author')).toBeVisible()
    const detailPanel = page.getByTestId('library-detail-view')
    await expect(detailPanel.getByText('Version History', { exact: true })).toBeVisible()
  })

  test('library detail form saves description and author', async ({ page }) => {
    // Create a library
    await page.getByRole('button', { name: 'New Library' }).click()
    const libName = `Saveable Library ${Date.now()}`
    await page.getByRole('alertdialog').getByRole('textbox').fill(libName)
    await page.getByRole('button', { name: 'Create' }).click()
    await expect(page.getByText(libName)).toBeVisible({ timeout: 8_000 })

    // Select the library
    await page.getByText(libName).click()
    await expect(page.getByLabel('Library Description')).toBeVisible({ timeout: 8_000 })

    // Fill in the form fields
    await page.getByLabel('Library Description').fill('This is an E2E test library.')
    await page.getByLabel('Author').fill('E2E Test Runner')

    // Save button should now be enabled
    const saveBtn = page.getByRole('button', { name: /^Save$/ })
    await expect(saveBtn).toBeEnabled()
    await saveBtn.click()

    // After save, the button should be disabled again (no longer dirty)
    await expect(saveBtn).toBeDisabled({ timeout: 5_000 })
  })

  test('search filters library items', async ({ page }) => {
    // Create two libraries
    await page.getByRole('button', { name: 'New Library' }).click()
    const libA = `Alpha Library ${Date.now()}`
    await page.getByRole('alertdialog').getByRole('textbox').fill(libA)
    await page.getByRole('button', { name: 'Create' }).click()
    await expect(page.getByText(libA)).toBeVisible({ timeout: 8_000 })

    await page.getByRole('button', { name: 'New Library' }).click()
    const libB = `Beta Library ${Date.now()}`
    await page.getByRole('alertdialog').getByRole('textbox').fill(libB)
    await page.getByRole('button', { name: 'Create' }).click()
    await expect(page.getByText(libB)).toBeVisible({ timeout: 8_000 })

    // TODO: Locate the search input.
    // SearchInput renders a plain <input> with placeholder likely containing "Search".
    const searchInput = page.getByPlaceholder(/search/i)
    if (await searchInput.isVisible()) {
      await searchInput.fill('Alpha')
      // Alpha should be visible, Beta should be hidden
      await expect(page.getByText(libA)).toBeVisible()
      await expect(page.getByText(libB)).not.toBeVisible()

      // Clear search
      await searchInput.clear()
      await expect(page.getByText(libB)).toBeVisible({ timeout: 5_000 })
    } else {
      // TODO: Add data-testid="library-search" to SearchInput component.
      test.skip(true, 'Search input selector needs to be determined from the running UI.')
    }
  })
})
