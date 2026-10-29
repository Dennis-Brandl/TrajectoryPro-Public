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
 * Canvas node interaction tests — drag from palette, connect nodes, delete.
 *
 * Architecture notes:
 *  - The canvas is a React Flow instance rendered in the main content area.
 *  - The palette panel on the left sidebar shows node types as draggable items
 *    when a workflow specification is selected.
 *  - Palette items are dragged onto the .react-flow__pane drop target.
 *  - Nodes render as .react-flow__node elements.
 *  - Edges render as .react-flow__edge elements inside the SVG layer.
 *  - Deleting a node: select it (click) then press Delete key.
 *  - Connecting nodes: drag from a source handle to a target handle.
 *
 * TODO: Add data-testid="palette-item-{nodeType}" to palette items to make
 *       drag sources reliably selectable without relying on text content.
 * TODO: Add data-testid="canvas-pane" to the React Flow wrapper div.
 */

async function setupWorkflow(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('tab', { name: 'Workflows' })).toBeVisible({ timeout: 15_000 })

  // Create a workflow library and specification so the canvas is active
  await page.getByRole('button', { name: 'New Library' }).click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await page.getByRole('alertdialog').getByRole('textbox').fill('Canvas Test Library')
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByText('Canvas Test Library').first()).toBeVisible({ timeout: 8_000 })

  // Open context menu and add a workflow spec
  const libraryRow = page.getByText('Canvas Test Library').first().locator('..')
  await libraryRow.hover()
  await libraryRow.locator('button').filter({ hasText: '' }).last().click()
  await page.getByRole('menuitem', { name: 'Add Workflow' }).click()
  await page.getByRole('alertdialog').getByRole('textbox').fill('Canvas Test Workflow')
  await page.getByRole('button', { name: 'Create' }).click()

  // Wait for the specification to be selected and canvas to be active
  await expect(page.getByText('Canvas Test Workflow').first()).toBeVisible({ timeout: 8_000 })
  await page.getByText('Canvas Test Workflow').first().click()

  // Canvas should be visible
  await expect(page.locator('.react-flow')).toBeVisible({ timeout: 8_000 })
}

test.describe('Canvas nodes', () => {
  test.use({ storageState: ADMIN_STORAGE_STATE })

  test.beforeEach(async ({ page }) => {
    await setupWorkflow(page)
  })

  test('canvas renders when a workflow specification is selected', async ({ page }) => {
    // The React Flow canvas container should be present
    await expect(page.locator('.react-flow')).toBeVisible()
    // The React Flow pane (background) should be present
    await expect(page.locator('.react-flow__pane')).toBeVisible()
  })

  test.fixme('drag a Start node from palette onto the canvas', async ({ page }) => {
    /**
     * TODO: This test requires:
     *  1. The palette to be visible (it renders when a workflow spec is selected).
     *  2. A draggable palette item for the "Start" node type.
     *
     * Suggested implementation:
     *  - Add data-testid="palette-item-start" to the Start palette item.
     *  - Use page.dragAndDrop() or manual dispatchEvent approach.
     *
     * React Flow drag-from-external-source requires dispatching a dragstart event
     * on the palette item and a drop event on the .react-flow__pane.
     */
    const canvas = page.locator('.react-flow__pane')
    const canvasBounds = await canvas.boundingBox()
    if (!canvasBounds) throw new Error('Canvas not found')

    // Locate the Start node palette item
    // TODO: Replace with data-testid when added to the component.
    const paletteStartItem = page.getByTestId('palette-item-start')

    await paletteStartItem.dragTo(canvas, {
      targetPosition: {
        x: canvasBounds.width / 2,
        y: canvasBounds.height / 2,
      },
    })

    // A node should appear on the canvas
    await expect(page.locator('.react-flow__node')).toHaveCount(1, { timeout: 5_000 })
  })

  test.fixme('connect two nodes with an edge', async () => {
    /**
     * TODO: This test requires nodes to already be on the canvas.
     * Precondition: Add a Start and an End node via the UI first.
     *
     * Connecting nodes in React Flow:
     *  - Drag from source handle (.react-flow__handle.source on first node)
     *    to target handle (.react-flow__handle.target on second node).
     *
     * Suggested approach once nodes are on canvas:
     *
     * const sourceHandle = page.locator('.react-flow__node').first()
     *   .locator('.react-flow__handle.source');
     * const targetHandle = page.locator('.react-flow__node').last()
     *   .locator('.react-flow__handle.target');
     * await sourceHandle.dragTo(targetHandle);
     * await expect(page.locator('.react-flow__edge')).toHaveCount(1);
     */
  })

  test.fixme('delete a selected node with the Delete key', async () => {
    /**
     * TODO: Requires a node to be on the canvas first.
     * Once a node exists:
     *
     * // Click the node to select it
     * await page.locator('.react-flow__node').first().click();
     * // Node should be selected (has .selected class)
     * await expect(page.locator('.react-flow__node.selected')).toHaveCount(1);
     *
     * // Press Delete to remove it
     * await page.keyboard.press('Delete');
     * await expect(page.locator('.react-flow__node')).toHaveCount(0);
     */
  })

  test.fixme('double-click a node to edit its label inline', async () => {
    /**
     * TODO: Once a node exists on canvas, double-clicking triggers inline label edit.
     * The EditableLabel component renders a contenteditable or input.
     *
     * await page.locator('.react-flow__node').first().dblclick();
     * // An editable element should appear
     * await page.keyboard.type('My Step Label');
     * await page.keyboard.press('Enter');
     * await expect(page.locator('.react-flow__node').first()).toContainText('My Step Label');
     */
  })

  test('canvas toolbar is visible when workflow is selected', async ({ page }) => {
    // The CanvasToolbar renders an Export button (dropdown trigger). It carries
    // data-testid="canvas-toolbar"; scope to it so the assertion cannot match the
    // LibrarySidebar's ExportMenu, which lives outside the canvas entirely.
    await expect(page.getByTestId('canvas-toolbar').getByRole('button', { name: /Export/i })).toBeVisible({
      timeout: 8_000,
    })
  })
})
