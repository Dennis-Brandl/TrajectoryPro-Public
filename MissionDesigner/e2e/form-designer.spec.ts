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
 * Form Designer tests — open, add elements, switch layouts.
 *
 * Architecture notes:
 *  - The form designer opens as a full-screen modal (Dialog.Root from Radix UI).
 *  - It is triggered by clicking a "Design Form" or similar button on a step node
 *    (formEntryStep, instructionStep, textInputStep, etc.) in the canvas.
 *  - The modal aria-label is "Form Designer".
 *  - Three-column layout: ElementPalette (left, 200px) | FormCanvas (center) | Inspector (right).
 *  - Layout tabs inside FormCanvas: Phone | Tablet | Desktop.
 *  - ElementPalette contains draggable items (Label, Input, Button, etc.).
 *  - Toolbar has "Save" and "Cancel" / "X" buttons.
 *  - Save commits the form layout back to the node's data.
 *
 * Opening the form designer:
 *  - The form designer is opened via useFormDesignerStore.getState().openForNode(nodeId, layouts).
 *  - In the UI, it's triggered by a button on the selected step node (properties panel or node itself).
 *  - TODO: Locate the exact "Design Form" trigger button — add data-testid="open-form-designer" to it.
 *
 * This test file is mostly fixme until nodes can be added to the canvas and
 * a step node selected to reveal the form designer trigger.
 */

async function setupAndLogin(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('tab', { name: 'Workflows' })).toBeVisible({ timeout: 15_000 })

  // Create library + workflow spec
  await page.getByRole('button', { name: 'New Library' }).click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await page.getByRole('alertdialog').getByRole('textbox').fill('Form Designer Library')
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByText('Form Designer Library')).toBeVisible({ timeout: 8_000 })

  const libraryRow = page.getByText('Form Designer Library').locator('..')
  await libraryRow.hover()
  await libraryRow.locator('button').filter({ hasText: '' }).last().click()
  await page.getByRole('menuitem', { name: 'Add Workflow' }).click()
  await page.getByRole('alertdialog').getByRole('textbox').fill('Form Designer Workflow')
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByText('Form Designer Workflow')).toBeVisible({ timeout: 8_000 })
  await page.getByText('Form Designer Workflow').click()
  await expect(page.locator('.react-flow')).toBeVisible({ timeout: 8_000 })
}

test.describe('Form Designer', () => {
  test.use({ storageState: ADMIN_STORAGE_STATE })

  test.beforeEach(async ({ page }) => {
    await setupAndLogin(page)
  })

  test.fixme('open form designer on a step node', async () => {
    /**
     * TODO: Prerequisites:
     *  1. Add a formEntryStep (or instructionStep) node to the canvas via drag-and-drop.
     *  2. Click the node to select it.
     *  3. In the properties panel, click "Design Form" to open the designer.
     *     OR the node itself has a button that opens the designer.
     *
     * Add data-testid="open-form-designer" to the trigger button.
     *
     * await page.getByTestId('open-form-designer').click();
     *
     * // The full-screen form designer modal should open
     * const designer = page.getByRole('dialog', { name: 'Form Designer' });
     * await expect(designer).toBeVisible({ timeout: 5_000 });
     *
     * // The three columns should be present
     * // Left: element palette
     * // Center: canvas with layout tabs
     * // Right: inspector
     *
     * // Layout tabs should be visible
     * await expect(page.getByRole('button', { name: 'Phone' })).toBeVisible();
     * await expect(page.getByRole('button', { name: 'Tablet' })).toBeVisible();
     * await expect(page.getByRole('button', { name: 'Desktop' })).toBeVisible();
     */
  })

  test.fixme('switch between layout tabs (Phone / Tablet / Desktop)', async () => {
    /**
     * TODO: Requires form designer to be open (see above).
     *
     * After opening the form designer:
     *
     * // Default is Phone
     * // The active tab has blue text and blue bottom border
     * const phoneTab = page.getByRole('button', { name: 'Phone' });
     * const tabletTab = page.getByRole('button', { name: 'Tablet' });
     * const desktopTab = page.getByRole('button', { name: 'Desktop' });
     *
     * await tabletTab.click();
     * // Tablet tab should be active (blue styling)
     * // The canvas size should change to 768x1024
     *
     * await desktopTab.click();
     * // Desktop tab should be active
     * // The canvas size should change to 1280x800
     *
     * await phoneTab.click();
     * // Phone tab should be active
     */
  })

  test.fixme('add a form element from the palette', async () => {
    /**
     * TODO: Requires form designer to be open.
     *
     * The ElementPalette on the left lists element types that can be dragged onto the canvas.
     * Common elements: Label, Input, Button, Image, Divider, etc.
     *
     * Add data-testid="palette-element-{elementType}" to palette items.
     *
     * // Drag a Label element onto the form canvas
     * const labelPaletteItem = page.getByTestId('palette-element-label');
     * const formCanvas = page.locator('[data-testid="form-canvas"]');
     *
     * await labelPaletteItem.dragTo(formCanvas, {
     *   targetPosition: { x: 200, y: 200 }
     * });
     *
     * // An element should appear on the canvas (via RndElement)
     * // TODO: Identify how elements are rendered in the DOM.
     * // They're rendered by ElementLayer as absolutely-positioned RndElement components.
     * await expect(page.locator('[data-testid="form-element"]')).toHaveCount(1);
     */
  })

  test.fixme('save form design and verify it persists', async () => {
    /**
     * TODO: After adding elements to the form:
     *
     * // Click Save in the form designer toolbar
     * await page.getByRole('button', { name: 'Save' }).click();
     *
     * // The modal should close
     * await expect(page.getByRole('dialog', { name: 'Form Designer' })).not.toBeVisible();
     *
     * // Re-open the form designer on the same node — elements should still be there
     * await page.getByTestId('open-form-designer').click();
     * await expect(page.locator('[data-testid="form-element"]')).toHaveCount(1);
     */
  })

  test.fixme('cancel form design discards unsaved changes', async () => {
    /**
     * TODO: After adding elements without saving:
     *
     * // There's an element on canvas (not yet saved)
     * // Press Escape or click Cancel
     * await page.keyboard.press('Escape');
     *
     * // A browser confirm() dialog appears asking to save or discard
     * // (Uses window.confirm — needs page.on('dialog'))
     * page.on('dialog', async (dialog) => {
     *   // Click Cancel (Don't Save) to discard changes
     *   await dialog.dismiss();
     * });
     *
     * // Modal should close
     * await expect(page.getByRole('dialog', { name: 'Form Designer' })).not.toBeVisible();
     */
  })

  test.fixme('form designer keyboard shortcuts work', async () => {
    /**
     * TODO: Requires form designer to be open with elements present.
     *
     * Keyboard shortcuts (from FormDesignerModal.handleKeyDown):
     *  - Delete / Backspace: delete selected elements
     *  - Ctrl+Z: undo
     *  - Ctrl+Shift+Z or Ctrl+Y: redo
     *  - Ctrl+C: copy
     *  - Ctrl+V: paste
     *  - Ctrl+D: duplicate
     *  - Ctrl+A: select all
     *  - Arrow keys: move selected (1px; 10px with Shift)
     */
  })
})
