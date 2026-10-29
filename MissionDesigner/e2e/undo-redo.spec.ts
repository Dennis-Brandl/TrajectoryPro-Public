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
 * Undo / Redo tests — workflow canvas level undo/redo via Zundo temporal store.
 *
 * Architecture notes:
 *  - Undo/Redo is provided by Zundo (temporal middleware on Zustand flowStore).
 *  - Capacity: 100 states.
 *  - Keyboard shortcuts: Ctrl+Z (undo), Ctrl+Shift+Z or Ctrl+Y (redo).
 *  - The undo/redo is scoped to the canvas (flowStore) — NOT the library store.
 *  - Temporal store is PAUSED while the form designer modal is open.
 *
 * Observable changes that can be undone:
 *  - Adding a node (via drag-and-drop from palette)
 *  - Moving a node (drag within canvas)
 *  - Deleting a node (click + Delete key)
 *  - Adding an edge
 *  - Renaming a node label (EditableLabel double-click)
 *  - Updating node data (properties panel changes)
 *
 * TODO: Most of these tests require canvas node manipulation which depends on
 *       the palette drag-and-drop working (see canvas-nodes.spec.ts TODOs).
 *       These tests are marked fixme pending that foundation.
 *
 * What CAN be tested without nodes:
 *  - Keyboard shortcut does not crash on empty canvas.
 *  - Undo/redo buttons in the toolbar (if they exist) are in the right state.
 */

async function setupAndLogin(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('tab', { name: 'Workflows' })).toBeVisible({ timeout: 15_000 })

  // Create library + workflow spec to activate the canvas
  await page.getByRole('button', { name: 'New Library' }).click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await page.getByRole('alertdialog').getByRole('textbox').fill('Undo Test Library')
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByText('Undo Test Library').first()).toBeVisible({ timeout: 8_000 })

  const libraryRow = page.getByText('Undo Test Library').first().locator('..')
  await libraryRow.hover()
  await libraryRow.locator('button').filter({ hasText: '' }).last().click()
  await page.getByRole('menuitem', { name: 'Add Workflow' }).click()
  await page.getByRole('alertdialog').getByRole('textbox').fill('Undo Test Workflow')
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByText('Undo Test Workflow').first()).toBeVisible({ timeout: 8_000 })
  await page.getByText('Undo Test Workflow').first().click()
  await expect(page.locator('.react-flow')).toBeVisible({ timeout: 8_000 })
}

test.describe('Undo and Redo', () => {
  test.use({ storageState: ADMIN_STORAGE_STATE })

  test.beforeEach(async ({ page }) => {
    await setupAndLogin(page)
  })

  test('Ctrl+Z on empty canvas does not throw or crash', async ({ page }) => {
    // Focus the canvas area first
    await page.locator('.react-flow').click()

    // Press undo on an empty canvas — should be a no-op, not a crash
    await page.keyboard.press('Control+z')

    // App should still be alive — canvas is visible
    await expect(page.locator('.react-flow')).toBeVisible()
  })

  test('Ctrl+Y (redo) on empty canvas does not throw or crash', async ({ page }) => {
    await page.locator('.react-flow').click()
    await page.keyboard.press('Control+y')
    await expect(page.locator('.react-flow')).toBeVisible()
  })

  test('Ctrl+Shift+Z (redo) on empty canvas does not throw or crash', async ({ page }) => {
    await page.locator('.react-flow').click()
    await page.keyboard.press('Control+Shift+z')
    await expect(page.locator('.react-flow')).toBeVisible()
  })

  test.fixme('undo after adding a node removes it from canvas', async () => {
    /**
     * TODO: Requires drag-and-drop from palette to add a node.
     *
     * // Add a node (e.g., Start node) to the canvas
     * const paletteItem = page.getByTestId('palette-item-start');
     * const canvas = page.locator('.react-flow__pane');
     * await paletteItem.dragTo(canvas);
     *
     * // Verify node was added
     * await expect(page.locator('.react-flow__node')).toHaveCount(1);
     *
     * // Focus canvas and press Ctrl+Z
     * await page.locator('.react-flow').click();
     * await page.keyboard.press('Control+z');
     *
     * // Node should be removed
     * await expect(page.locator('.react-flow__node')).toHaveCount(0);
     */
  })

  test.fixme('redo after undo re-adds the node', async () => {
    /**
     * TODO: Requires add-node from palette (see above).
     *
     * // Add node, undo, redo
     * // ...add node...
     * await expect(page.locator('.react-flow__node')).toHaveCount(1);
     *
     * await page.keyboard.press('Control+z');
     * await expect(page.locator('.react-flow__node')).toHaveCount(0);
     *
     * await page.keyboard.press('Control+y');
     * await expect(page.locator('.react-flow__node')).toHaveCount(1);
     */
  })

  test.fixme('multiple undos revert through history', async () => {
    /**
     * TODO: Requires multiple canvas operations.
     *
     * // Add 3 nodes
     * // ...add node1, node2, node3...
     * await expect(page.locator('.react-flow__node')).toHaveCount(3);
     *
     * // Undo 3 times
     * await page.keyboard.press('Control+z');
     * await expect(page.locator('.react-flow__node')).toHaveCount(2);
     *
     * await page.keyboard.press('Control+z');
     * await expect(page.locator('.react-flow__node')).toHaveCount(1);
     *
     * await page.keyboard.press('Control+z');
     * await expect(page.locator('.react-flow__node')).toHaveCount(0);
     */
  })

  test.fixme('undo after deleting a node restores it', async () => {
    /**
     * TODO: Requires a node to exist on canvas.
     *
     * // Delete a node
     * await page.locator('.react-flow__node').first().click();
     * await page.keyboard.press('Delete');
     * await expect(page.locator('.react-flow__node')).toHaveCount(0);
     *
     * // Undo
     * await page.keyboard.press('Control+z');
     * await expect(page.locator('.react-flow__node')).toHaveCount(1);
     */
  })

  test.fixme('undo after renaming a node restores original label', async () => {
    /**
     * TODO: Requires a node with an editable label (EditableLabel).
     *
     * // Double-click node to enter label edit mode
     * await page.locator('.react-flow__node').first().dblclick();
     *
     * // Type new label
     * await page.keyboard.press('Control+a');
     * await page.keyboard.type('New Label');
     * await page.keyboard.press('Enter');
     *
     * await expect(page.locator('.react-flow__node').first()).toContainText('New Label');
     *
     * // Undo
     * await page.keyboard.press('Control+z');
     *
     * // Original label should be restored
     * await expect(page.locator('.react-flow__node').first()).not.toContainText('New Label');
     */
  })
})
