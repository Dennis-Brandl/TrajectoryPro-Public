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

import { test, expect, type Page } from '@playwright/test'
import { ADMIN_STORAGE_STATE } from './helpers/session'

/**
 * Notation switching tests — Flowchart, BPMN, ISA88.
 *
 * Selector notes:
 *  - The NotationSwitcher renders a dropdown Button with the current notation name.
 *  - Default: "Flowchart Style"
 *  - Dropdown items: "Flowchart Style", "BPMN Style", "ISA 88 Style"
 *  - When nodes exist, switching shows an AlertDialog confirmation:
 *    "Switch to {notation} Notation?"  with "Switch Notation" and "Cancel" buttons.
 *  - When canvas is empty, switching happens immediately (no dialog).
 *
 * The NotationSwitcher is rendered in the main workflow canvas area.
 * It appears in the SpecificationHeader when a workflow spec is selected.
 */

async function setupWorkflowAndLogin(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('tab', { name: 'Workflows' })).toBeVisible({ timeout: 15_000 })

  // Create library + workflow spec to activate the canvas
  await page.getByRole('button', { name: 'New Library' }).click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await page.getByRole('alertdialog').getByRole('textbox').fill('Notation Test Library')
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByText('Notation Test Library').first()).toBeVisible({ timeout: 8_000 })

  const libraryRow = page.getByText('Notation Test Library').first().locator('..')
  await libraryRow.hover()
  await libraryRow.locator('button').filter({ hasText: '' }).last().click()
  await page.getByRole('menuitem', { name: 'Add Workflow' }).click()
  await page.getByRole('alertdialog').getByRole('textbox').fill('Notation Test Workflow')
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByText('Notation Test Workflow').first()).toBeVisible({ timeout: 8_000 })
  await page.getByText('Notation Test Workflow').first().click()

  // Canvas active
  await expect(page.locator('.react-flow')).toBeVisible({ timeout: 8_000 })
}

test.describe('Notation switching', () => {
  test.use({ storageState: ADMIN_STORAGE_STATE })

  test.beforeEach(async ({ page }) => {
    await setupWorkflowAndLogin(page)
  })

  test('notation switcher dropdown is visible with Flowchart Style as default', async ({ page }) => {
    // The NotationSwitcher button shows the current notation
    const switcher = page.getByRole('button', { name: /Flowchart Style/i })
    await expect(switcher).toBeVisible({ timeout: 8_000 })
  })

  test('switch to BPMN Style on empty canvas (no confirmation dialog)', async ({ page }) => {
    // Empty canvas — no nodes, so no confirmation dialog
    const switcher = page.getByRole('button', { name: /Flowchart Style/i })
    await switcher.click()

    // Dropdown opens
    await expect(page.getByRole('menuitem', { name: 'BPMN Style' })).toBeVisible()
    await page.getByRole('menuitem', { name: 'BPMN Style' }).click()

    // No confirmation dialog on empty canvas — notation changes immediately
    // The button label should update to BPMN Style
    await expect(page.getByRole('button', { name: /BPMN Style/i })).toBeVisible({ timeout: 5_000 })
  })

  test('switch to ISA 88 Style on empty canvas', async ({ page }) => {
    const switcher = page.getByRole('button', { name: /Flowchart Style/i })
    await switcher.click()
    await expect(page.getByRole('menuitem', { name: 'ISA 88 Style' })).toBeVisible()
    await page.getByRole('menuitem', { name: 'ISA 88 Style' }).click()

    await expect(page.getByRole('button', { name: /ISA 88 Style/i })).toBeVisible({ timeout: 5_000 })
  })

  test('switch back to Flowchart Style from BPMN', async ({ page }) => {
    // First switch to BPMN
    await page.getByRole('button', { name: /Flowchart Style/i }).click()
    await page.getByRole('menuitem', { name: 'BPMN Style' }).click()
    await expect(page.getByRole('button', { name: /BPMN Style/i })).toBeVisible({ timeout: 5_000 })

    // Then switch back to Flowchart
    await page.getByRole('button', { name: /BPMN Style/i }).click()
    await expect(page.getByRole('menuitem', { name: 'Flowchart Style' })).toBeVisible()
    await page.getByRole('menuitem', { name: 'Flowchart Style' }).click()
    await expect(page.getByRole('button', { name: /Flowchart Style/i })).toBeVisible({ timeout: 5_000 })
  })

  test('selecting the current notation does not open a confirmation dialog', async ({ page }) => {
    // Click the dropdown and select the already-active notation
    const switcher = page.getByRole('button', { name: /Flowchart Style/i })
    await switcher.click()
    await page.getByRole('menuitem', { name: 'Flowchart Style' }).click()

    // No AlertDialog should appear (handleSelect returns early for same notation)
    await expect(page.getByRole('alertdialog')).not.toBeVisible()
  })

  test.fixme('confirmation dialog appears when switching notation with nodes on canvas', async () => {
    /**
     * TODO: Add nodes to the canvas first (requires drag-and-drop from palette).
     * Once nodes exist, switching notation should show:
     * "Switch to BPMN Style Notation?" with a "Switch Notation" button.
     *
     * await page.getByRole('button', { name: /Flowchart Style/i }).click();
     * await page.getByRole('menuitem', { name: 'BPMN Style' }).click();
     *
     * // AlertDialog should appear
     * await expect(page.getByRole('alertdialog')).toBeVisible();
     * await expect(page.getByText('Switch to BPMN Style Notation?')).toBeVisible();
     *
     * await page.getByRole('button', { name: 'Switch Notation' }).click();
     * await expect(page.getByRole('button', { name: /BPMN Style/i })).toBeVisible();
     */
  })

  test.fixme('cancel button in confirmation dialog keeps current notation', async () => {
    /**
     * TODO: Requires nodes on canvas.
     *
     * // Open dialog
     * await page.getByRole('button', { name: /Flowchart Style/i }).click();
     * await page.getByRole('menuitem', { name: 'BPMN Style' }).click();
     * await expect(page.getByRole('alertdialog')).toBeVisible();
     *
     * // Cancel
     * await page.getByRole('button', { name: 'Cancel' }).click();
     *
     * // Notation should remain Flowchart
     * await expect(page.getByRole('button', { name: /Flowchart Style/i })).toBeVisible();
     */
  })

  test('canvas re-renders after notation switch (react-flow element still present)', async ({ page }) => {
    // Switch from Flowchart to ISA88 and verify canvas is still mounted
    await page.getByRole('button', { name: /Flowchart Style/i }).click()
    await page.getByRole('menuitem', { name: 'ISA 88 Style' }).click()
    await expect(page.getByRole('button', { name: /ISA 88 Style/i })).toBeVisible({ timeout: 5_000 })

    // React Flow container should still be in the DOM
    await expect(page.locator('.react-flow')).toBeVisible()
    await expect(page.locator('.react-flow__pane')).toBeVisible()
  })
})
