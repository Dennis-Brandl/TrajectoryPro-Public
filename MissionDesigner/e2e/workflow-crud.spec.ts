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
 * Workflow CRUD tests — create, rename, delete workflow specifications.
 *
 * Selector notes:
 *  - Left sidebar has entity type tabs (Workflow, Step, Environment, Action).
 *  - "New Library" button is at the bottom of the sidebar panel.
 *  - Library items in the tree show a "..." (MoreHorizontal) context menu on hover.
 *  - Context menu items: "Add Workflow", "Add Sub-Library", "Rename", "Delete".
 *  - Specification items appear inside expanded libraries as FileText items.
 *  - Rename and delete use AlertDialog with an Input field.
 */

test.describe('Workflow CRUD', () => {
  test.use({ storageState: ADMIN_STORAGE_STATE })

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('tab', { name: 'Workflows' })).toBeVisible({ timeout: 15_000 })
  })

  test('create a new workflow library', async ({ page }) => {
    // The Workflow tab should be visible in the left sidebar
    // TODO: Confirm the exact tab label and selector from the running UI.
    // The entity type tabs are rendered inside the left panel.
    await expect(page.getByText('New Library')).toBeVisible({ timeout: 8_000 })

    // Click "New Library" button to open the creation dialog
    await page.getByRole('button', { name: 'New Library' }).click()

    // AlertDialog should open with "Create Workflow Library" title
    await expect(page.getByRole('alertdialog')).toBeVisible()
    await expect(page.getByText('Create Workflow Library')).toBeVisible()

    // Type the library name
    const libraryName = `E2E Library ${Date.now()}`
    await page.getByRole('alertdialog').getByRole('textbox').fill(libraryName)
    await page.getByRole('button', { name: 'Create' }).click()

    // Dialog should close and library should appear in the tree
    await expect(page.getByRole('alertdialog')).not.toBeVisible()
    await expect(page.getByText(libraryName).first()).toBeVisible()
  })

  test('create a new workflow specification inside a library', async ({ page }) => {
    // First create a library
    await page.getByRole('button', { name: 'New Library' }).click()
    await expect(page.getByRole('alertdialog')).toBeVisible()

    const libraryName = `Spec Library ${Date.now()}`
    await page.getByRole('alertdialog').getByRole('textbox').fill(libraryName)
    await page.getByRole('button', { name: 'Create' }).click()
    await expect(page.getByText(libraryName).first()).toBeVisible({ timeout: 8_000 })

    // Hover over the library to reveal the "..." context menu button
    const libraryRow = page.getByText(libraryName).first().locator('..')
    await libraryRow.hover()

    // Click the "..." button (MoreHorizontal, appears on hover)
    // TODO: Verify the exact aria-label or test-id of the more-options button.
    // It currently has no accessible label — consider adding aria-label="Library options".
    const moreBtn = libraryRow.locator('button').filter({ hasText: '' }).last()
    await moreBtn.click()

    // Click "Add Workflow" in the dropdown
    await page.getByRole('menuitem', { name: 'Add Workflow' }).click()

    // AlertDialog: "Add Master Workflow"
    await expect(page.getByRole('alertdialog')).toBeVisible()

    const specName = `My E2E Workflow ${Date.now()}`
    await page.getByRole('alertdialog').getByRole('textbox').fill(specName)
    await page.getByRole('button', { name: 'Create' }).click()

    // Dialog closes and spec appears in the tree
    await expect(page.getByRole('alertdialog')).not.toBeVisible()
    await expect(page.getByText(specName).first()).toBeVisible({ timeout: 8_000 })
  })

  test('rename a workflow library', async ({ page }) => {
    // Create a library to rename
    await page.getByRole('button', { name: 'New Library' }).click()
    await expect(page.getByRole('alertdialog')).toBeVisible()

    const originalName = `Rename Me ${Date.now()}`
    await page.getByRole('alertdialog').getByRole('textbox').fill(originalName)
    await page.getByRole('button', { name: 'Create' }).click()
    await expect(page.getByText(originalName).first()).toBeVisible({ timeout: 8_000 })

    // Open the context menu on the library
    const libraryRow = page.getByText(originalName).first().locator('..')
    await libraryRow.hover()
    const moreBtn = libraryRow.locator('button').filter({ hasText: '' }).last()
    await moreBtn.click()

    await page.getByRole('menuitem', { name: 'Rename' }).click()

    // AlertDialog: "Rename Library"
    await expect(page.getByRole('alertdialog')).toBeVisible()
    await expect(page.getByText('Rename Library')).toBeVisible()

    const newName = `Renamed Library ${Date.now()}`
    const input = page.getByRole('alertdialog').getByRole('textbox')
    await input.clear()
    await input.fill(newName)
    await page.getByRole('button', { name: 'Rename' }).click()

    // Old name gone, new name present
    await expect(page.getByRole('alertdialog')).not.toBeVisible()
    await expect(page.getByText(newName).first()).toBeVisible({ timeout: 8_000 })
    await expect(page.getByRole('tree').getByText(originalName)).not.toBeVisible()
  })

  test('delete a workflow library', async ({ page }) => {
    // Create a library to delete
    await page.getByRole('button', { name: 'New Library' }).click()
    await expect(page.getByRole('alertdialog')).toBeVisible()

    const libraryName = `Delete Me ${Date.now()}`
    await page.getByRole('alertdialog').getByRole('textbox').fill(libraryName)
    await page.getByRole('button', { name: 'Create' }).click()
    await expect(page.getByText(libraryName).first()).toBeVisible({ timeout: 8_000 })

    // Open the context menu
    const libraryRow = page.getByText(libraryName).first().locator('..')
    await libraryRow.hover()
    const moreBtn = libraryRow.locator('button').filter({ hasText: '' }).last()
    await moreBtn.click()

    await page.getByRole('menuitem', { name: 'Delete' }).click()

    // Confirmation dialog: "Delete Library"
    await expect(page.getByRole('alertdialog')).toBeVisible()
    await expect(page.getByText('Delete Library')).toBeVisible()
    await expect(page.getByText(`Are you sure you want to delete "${libraryName}"`)).toBeVisible()

    await page.getByRole('button', { name: 'Delete' }).click()

    // Library should disappear from the tree
    await expect(page.getByRole('alertdialog')).not.toBeVisible()
    await expect(page.getByText(libraryName)).not.toBeVisible({ timeout: 8_000 })
  })

  test('delete a workflow specification', async ({ page }) => {
    // Create library + spec
    await page.getByRole('button', { name: 'New Library' }).click()
    await expect(page.getByRole('alertdialog')).toBeVisible()

    const libraryName = `Spec Delete Library ${Date.now()}`
    await page.getByRole('alertdialog').getByRole('textbox').fill(libraryName)
    await page.getByRole('button', { name: 'Create' }).click()
    await expect(page.getByText(libraryName).first()).toBeVisible({ timeout: 8_000 })

    // Add a workflow spec
    const libraryRow = page.getByText(libraryName).first().locator('..')
    await libraryRow.hover()
    const moreBtn = libraryRow.locator('button').filter({ hasText: '' }).last()
    await moreBtn.click()
    await page.getByRole('menuitem', { name: 'Add Workflow' }).click()

    const specName = `Delete This Spec ${Date.now()}`
    await page.getByRole('alertdialog').getByRole('textbox').fill(specName)
    await page.getByRole('button', { name: 'Create' }).click()
    await expect(page.getByRole('tree').getByText(specName)).toBeVisible({ timeout: 8_000 })

    // Hover over the spec row to reveal the "Item actions" button
    const specRow = page.getByRole('tree').getByText(specName).locator('../..')
    await specRow.hover()

    // Click the "Item actions" button on the spec row (revealed on hover), then choose Delete
    await specRow.getByRole('button', { name: 'Item actions' }).click()
    await page.getByRole('menuitem', { name: 'Delete' }).click()

    // Confirmation dialog
    await expect(page.getByRole('alertdialog')).toBeVisible()
    await expect(page.getByText(`Are you sure you want to delete "${specName}"`)).toBeVisible()

    await page.getByRole('button', { name: 'Delete' }).click()

    await expect(page.getByRole('tree').getByText(specName)).not.toBeVisible({ timeout: 8_000 })
  })
})
