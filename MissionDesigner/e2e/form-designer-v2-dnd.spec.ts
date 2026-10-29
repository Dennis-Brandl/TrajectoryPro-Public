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
// Real-browser regression coverage for the v2 form designer's drag-and-drop and
// span-resize surface (P3.3a structural DnD + P3.3b span-drag / §14.4 hover-gating).
// These behaviours depend on real layout geometry, @dnd-kit's PointerSensor +
// pointerWithin collision detection, rAF-driven hover reveal, and CSS opacity/
// pointer-events transitions — none of which jsdom can exercise — so they live here
// as Chromium E2E rather than unit tests.
//
// Coverage:
//   1. open → palette click-insert → click-select → mouse drag-reorder →
//      save → reopen round-trip (persistence).
//   2. beside-drop joins single-block rows into one row and auto-apportions
//      spans (6/6 then 4/4/4); undo reverts exactly one drag at a time.
//   3. seam-drag redistributes spans (6/6 → ~8/4), §14.4 hover-gating hides
//      the seam until the row is hovered, keyboard splitter grows a block,
//      undo is per-commit, and Escape cancels a live drag without closing the
//      Radix modal.
//
// Dialog selectors: both v1 (`FormDesignerModal`) and v2 (`FormDocumentDesignerModal`)
// set an explicit `aria-label` on their `Dialog.Content` ("Form Designer" vs
// "Form Designer (v2)"), but both ALSO render a `Dialog.Title` ("Form Designer"). Radix
// auto-wires `aria-labelledby` to the Title, and per the ARIA accname algorithm
// `aria-labelledby` outranks `aria-label` — so BOTH dialogs' COMPUTED accessible name is
// "Form Designer", making `getByRole('dialog', { name })` unable to tell them apart. We
// match the literal `aria-label` DOM attribute instead (exact-equality attribute
// selector, which bypasses accname computation entirely).

import { test, expect, type Page, type ConsoleMessage } from '@playwright/test'
import { ADMIN_STORAGE_STATE } from './helpers/session'
import { dragStepFromPalette } from './helpers/drag'
import { paletteItem } from './helpers/selectors'

/** Collect console errors/warnings + uncaught page errors for the console-regression
 *  guard (chiefly duplicate-React "Invalid hook call", which the FormKit `file:`
 *  integration is uniquely prone to). */
function trackConsole(page: Page): string[] {
  const bucket: string[] = []
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      bucket.push(`[console.${msg.type()}] ${msg.text()}`)
    }
  })
  page.on('pageerror', (err) => bucket.push(`[pageerror] ${err.message}`))
  return bucket
}

/** `dragStepFromPalette` dispatches a synthetic DragEvent whose `dataTransfer` is null
 *  under programmatic dispatch, so the ReactFlow handler throws setting `dropEffect` —
 *  a pure test-harness artifact, never an app defect. */
const DROP_EFFECT_ARTIFACT = /dropEffect/

/** Console/page issues that are genuine defects — everything not on the allow-list. */
function realConsoleIssues(bucket: string[], allow: RegExp[] = [DROP_EFFECT_ARTIFACT]): string[] {
  return bucket.filter((s) => !allow.some((re) => re.test(s)))
}

async function setupAndLogin(page: Page, libName: string, wfName: string): Promise<void> {
  await page.goto('/')
  await expect(page.getByRole('tab', { name: 'Workflows' })).toBeVisible({ timeout: 15_000 })

  await page.getByRole('button', { name: 'New Library' }).click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await page.getByRole('alertdialog').getByRole('textbox').fill(libName)
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByText(libName, { exact: true })).toBeVisible({ timeout: 8_000 })

  const libraryRow = page.getByText(libName, { exact: true }).locator('..')
  await libraryRow.hover()
  await page.waitForTimeout(100)
  await libraryRow.locator('button').filter({ hasText: '' }).last().click()
  await page.getByRole('menuitem', { name: 'Add Workflow' }).click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await page.getByRole('alertdialog').getByRole('textbox').fill(wfName)
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByRole('alertdialog')).not.toBeVisible()
  await expect(page.getByText(wfName, { exact: true }).first()).toBeVisible({ timeout: 8_000 })

  await page.getByText(wfName, { exact: true }).first().click()
  await expect(page.locator('.react-flow')).toBeVisible({ timeout: 8_000 })
}

/** Drag a userInteractionStep node onto the canvas and confirm exactly one node exists. */
async function addUserInteractionNode(page: Page): Promise<void> {
  await dragStepFromPalette(page, paletteItem(page, 'User Interaction'), 'userInteractionStep')
  await expect(page.locator('.react-flow__node')).toHaveCount(1, { timeout: 8_000 })
}

test.describe('v2 form designer — drag-and-drop & span-resize (real-browser)', () => {
  // The v2 Desktop breakpoint frame (1280px) + palette (~224px) + inspector (280px) needs
  // ~1784px. The default 1280×720 viewport centres/overflows the frame so elements flush
  // against its left edge (block grips at `rect.left - 8`) land at a NEGATIVE page x —
  // off-screen, so a mouse-driven drag starting there misses. 1920×1080 gives headroom.
  test.use({ storageState: ADMIN_STORAGE_STATE, viewport: { width: 1920, height: 1080 } })

  test('open → palette-insert → select → drag-reorder → save round-trip', async ({ page }) => {
    test.setTimeout(120_000)
    const consoleIssues = trackConsole(page)

    await setupAndLogin(page, `V2 DnD Lib ${Date.now()}`, `V2 DnD Wf ${Date.now()}`)
    await addUserInteractionNode(page)

    const dialog = page.locator('[aria-label="Form Designer (v2)"]')

    await test.step('1. v2 designer opens on double-click', async () => {
      await page.locator('.react-flow__node').first().dblclick()
      await expect(dialog).toBeVisible({ timeout: 8_000 })
    })

    await test.step('2. palette click-insert x3 → 3 blocks', async () => {
      await page.locator('[data-palette-drag="palette:text"]').click()
      await page.locator('[data-palette-drag="palette:textInput"]').click()
      await page.locator('[data-palette-drag="palette:textInput"]').click()
      await expect(page.locator('[data-block-id]')).toHaveCount(3, { timeout: 8_000 })
    })

    await test.step('3. click-to-select reveals the selection outline', async () => {
      // Blocks render inside an `inert` wrapper. jsdom does not implement inert's
      // click-blocking, but a real browser does — force:true drives the click past it,
      // exercising the rect-containment hit-test that replaced elementsFromPoint.
      await page.locator('[data-block-id]').first().click({ force: true })
      await expect(page.getByTestId('selection-outline')).toBeVisible({ timeout: 4_000 })
    })

    await test.step('4. mouse drag-reorder: first block → last gap moves it to the end', async () => {
      const readOrder = () =>
        page.locator('[data-block-id]').evaluateAll((els) => els.map((el) => el.getAttribute('data-block-id')))

      const orderBefore = await readOrder()
      expect(orderBefore).toHaveLength(3)

      const grip = page.locator('[data-drag-handle^="block:"]').first()
      await expect(grip).toBeVisible({ timeout: 8_000 })
      const gripBox = await grip.boundingBox()
      const dropBox = await page.locator('[data-drop-zone^="gap:"]').last().boundingBox()
      if (!gripBox || !dropBox) {
        throw new Error(`missing bounding box — grip=${gripBox} drop=${dropBox}`)
      }

      await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2)
      await page.mouse.down()
      // Exceed @dnd-kit's PointerSensor 4px activation constraint before travelling.
      await page.mouse.move(gripBox.x + gripBox.width / 2 + 8, gripBox.y + gripBox.height / 2, {
        steps: 3,
      })
      await page.mouse.move(dropBox.x + dropBox.width / 2, dropBox.y + dropBox.height / 2, {
        steps: 10,
      })
      await page.mouse.up()
      await page.waitForTimeout(400) // store update + re-render + rect remeasure settle

      const orderAfter = await readOrder()
      expect(orderAfter, 'no block lost or duplicated by the drag').toHaveLength(3)
      expect([...orderAfter].sort(), 'same block id set — reorder, not mutation').toEqual([...orderBefore].sort())
      expect(orderAfter, 'first block dropped on the last gap moves to the end').toEqual([
        orderBefore[1],
        orderBefore[2],
        orderBefore[0],
      ])
    })

    await test.step('5. save → reopen persists the 3 blocks with no error toast', async () => {
      const preSaveCount = await page.locator('[data-block-id]').count()
      expect(preSaveCount).toBe(3)

      await page.getByRole('button', { name: 'Save' }).click()
      await expect(dialog).not.toBeVisible({ timeout: 8_000 })
      await expect(
        page.locator('[data-sonner-toast]', { hasText: /invalid/i }),
        'save must not raise a validation-error toast',
      ).toHaveCount(0)

      await page.locator('.react-flow__node').first().dblclick()
      await expect(dialog).toBeVisible({ timeout: 8_000 })
      await expect(page.locator('[data-block-id]'), 'reopened document round-trips the same block count').toHaveCount(
        preSaveCount,
      )
    })

    expect(
      realConsoleIssues(consoleIssues),
      `unexpected v2 console/page issues: ${JSON.stringify(consoleIssues, null, 2)}`,
    ).toEqual([])
  })

  test('beside-drop joins rows + auto-apportions spans; undo is per-drag', async ({ page }) => {
    test.setTimeout(120_000)
    const consoleIssues = trackConsole(page)

    await setupAndLogin(page, `V2 Beside Lib ${Date.now()}`, `V2 Beside Wf ${Date.now()}`)
    await addUserInteractionNode(page)

    const dialog = page.locator('[aria-label="Form Designer (v2)"]')
    await page.locator('.react-flow__node').first().dblclick()
    await expect(dialog).toBeVisible({ timeout: 8_000 })

    // Real-browser grip→zone drag. @dnd-kit's pointerWithin tracks the pointer against
    // droppable RECTS (the zones are pointer-events:none), so we drive page.mouse to the
    // zone's geometric centre; the +8px first move clears the PointerSensor activation.
    const dragGripToZone = async (gripSel: string, zoneSel: string): Promise<void> => {
      const grip = page.locator(gripSel)
      await expect(grip).toBeVisible({ timeout: 8_000 })
      const gb = await grip.boundingBox()
      const zb = await page.locator(zoneSel).boundingBox()
      if (!gb || !zb) throw new Error(`missing box: grip=${gb} zone=${zb}`)
      await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2)
      await page.waitForTimeout(170) // §14.4 hover-gate: let the rAF reveal make the grip grabbable
      await page.mouse.down()
      await page.mouse.move(gb.x + gb.width / 2 + 8, gb.y + gb.height / 2, { steps: 3 })
      await page.mouse.move(zb.x + zb.width / 2, zb.y + zb.height / 2, { steps: 12 })
      await page.mouse.up()
      await page.waitForTimeout(450) // store update + re-render + rect remeasure settle
    }
    const boxOf = (id: string) => page.locator(`[data-block-id="${id}"]`).boundingBox()

    await test.step('insert 3 blocks → 3 single-block rows', async () => {
      for (let i = 0; i < 3; i++) await page.locator('[data-palette-drag="palette:textInput"]').click()
      await expect(page.locator('[data-block-id]')).toHaveCount(3, { timeout: 8_000 })
      await expect(page.locator('[data-drag-handle^="row:"]')).toHaveCount(3, { timeout: 8_000 })
    })

    const blockIds = (await page
      .locator('[data-block-id]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-block-id')))) as string[]
    const rowGripId = await page.locator('[data-drag-handle^="row:"]').first().getAttribute('data-drag-handle')
    const row0Id = (rowGripId ?? '').slice('row:'.length)
    const endSlot = `[data-drop-zone="slot:${row0Id}:@end"]`

    await test.step('beside-drop #1: block[1] beside block[0] → one row, 6/6', async () => {
      await dragGripToZone(`[data-drag-handle="block:${blockIds[1]}"]`, endSlot)
      await expect(page.locator('[data-drag-handle^="row:"]')).toHaveCount(2, { timeout: 8_000 })
      await expect(page.locator('[data-block-id]')).toHaveCount(3)
      const b0 = await boxOf(blockIds[0])
      const b1 = await boxOf(blockIds[1])
      expect(b0 && b1).toBeTruthy()
      expect(Math.abs(b0!.y - b1!.y), 'tops aligned → same row').toBeLessThan(6)
      expect(b1!.x, 'b1 sits to the right of b0').toBeGreaterThan(b0!.x)
      expect(Math.abs(b0!.width - b1!.width), 'even 6/6 split').toBeLessThan(b0!.width * 0.2)
    })

    await test.step('beside-drop #2: block[2] beside → one row, 4/4/4', async () => {
      await dragGripToZone(`[data-drag-handle="block:${blockIds[2]}"]`, endSlot)
      await expect(page.locator('[data-drag-handle^="row:"]')).toHaveCount(1, { timeout: 8_000 })
      await expect(page.locator('[data-block-id]')).toHaveCount(3)
      const boxes = [await boxOf(blockIds[0]), await boxOf(blockIds[1]), await boxOf(blockIds[2])]
      expect(boxes.every(Boolean)).toBeTruthy()
      const tops = boxes.map((b) => b!.y)
      const lefts = boxes.map((b) => b!.x)
      const widths = boxes.map((b) => b!.width)
      expect(Math.max(...tops) - Math.min(...tops), 'all three share one row').toBeLessThan(6)
      expect(lefts[0], 'left-to-right order preserved').toBeLessThan(lefts[1])
      expect(lefts[1]).toBeLessThan(lefts[2])
      const meanW = widths.reduce((a, b) => a + b, 0) / widths.length
      for (const w of widths) {
        expect(Math.abs(w - meanW) / meanW, 'even thirds → apportioned 4/4/4').toBeLessThan(0.25)
      }
    })

    await test.step('undo x2 reverts one beside-drag each (1 → 2 → 3 rows)', async () => {
      const undo = dialog.locator('[aria-label="Undo"]')
      await undo.click()
      await expect(page.locator('[data-drag-handle^="row:"]')).toHaveCount(2, { timeout: 8_000 })
      await undo.click()
      await expect(page.locator('[data-drag-handle^="row:"]')).toHaveCount(3, { timeout: 8_000 })
    })

    expect(
      realConsoleIssues(consoleIssues),
      `unexpected v2 console/page issues: ${JSON.stringify(consoleIssues, null, 2)}`,
    ).toEqual([])
  })

  test('seam-drag redistributes + §14.4 hover-gating + keyboard + undo + Escape-cancel', async ({ page }) => {
    test.setTimeout(120_000)
    const consoleIssues = trackConsole(page)
    await setupAndLogin(page, `V2 Seam Lib ${Date.now()}`, `V2 Seam Wf ${Date.now()}`)
    await addUserInteractionNode(page)
    const dialog = page.locator('[aria-label="Form Designer (v2)"]')
    await page.locator('.react-flow__node').first().dblclick()
    await expect(dialog).toBeVisible({ timeout: 8_000 })

    const boxOf = (id: string) => page.locator(`[data-block-id="${id}"]`).boundingBox()
    // §14.4: grips/seams are opacity:0 + pointer-events:none until the row is hovered; the
    // rAF reveal needs a frame + re-render, so move-then-settle before grabbing. A real
    // user's mouse crosses the row well before the handle; Playwright teleports, so we wait.
    const revealAt = async (x: number, y: number) => {
      await page.mouse.move(x, y)
      await page.waitForTimeout(180)
    }

    await page.locator('[data-palette-drag="palette:textInput"]').click()
    await page.locator('[data-palette-drag="palette:textInput"]').click()
    await expect(page.locator('[data-block-id]')).toHaveCount(2)
    const ids = (await page
      .locator('[data-block-id]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-block-id')))) as string[]
    const [b0, b1] = ids
    const row0Id = (await page.locator('[data-drag-handle^="row:"]').first().getAttribute('data-drag-handle'))!.slice(
      'row:'.length,
    )

    let colW = 100 // one grid column's px width, recomputed after the 6/6 join
    await test.step('setup: beside-join to a 6/6 row', async () => {
      const c1 = (await boxOf(b1))! // reveal via b1's block centre, then grab its grip
      await revealAt(c1.x + c1.width / 2, c1.y + c1.height / 2)
      const gb = (await page.locator(`[data-drag-handle="block:${b1}"]`).boundingBox())!
      const zb = (await page.locator(`[data-drop-zone="slot:${row0Id}:@end"]`).boundingBox())!
      await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2)
      await page.mouse.down()
      await page.mouse.move(gb.x + gb.width / 2 + 8, gb.y + gb.height / 2, { steps: 3 })
      await page.mouse.move(zb.x + zb.width / 2, zb.y + zb.height / 2, { steps: 12 })
      await page.mouse.up()
      await page.waitForTimeout(400)
      await expect(page.locator('[data-drag-handle^="row:"]')).toHaveCount(1)
      const box0 = (await boxOf(b0))!
      const box1 = (await boxOf(b1))!
      colW = (box1.x + box1.width - box0.x) / 12
      expect(Math.abs(box0.width - box1.width), 'joined row starts even 6/6').toBeLessThan(box0.width * 0.2)
    })

    const seamSel = `[data-seam-handle="seam:${b0}:${b1}"]`

    await test.step('§14.4 hover-gating: seam hidden until the row is hovered', async () => {
      await expect(page.locator(seamSel)).toHaveCount(1)
      await page.mouse.move(4, 4) // off the canvas host → pointerleave clears hover
      await page.waitForTimeout(230)
      const hidden = await page.locator(seamSel).evaluate((el) => getComputedStyle(el).opacity)
      const c0 = (await boxOf(b0))!
      await revealAt(c0.x + c0.width / 2, c0.y + c0.height / 2)
      const shown = await page.locator(seamSel).evaluate((el) => getComputedStyle(el).opacity)
      expect(hidden, 'seam hidden when row not hovered').toBe('0')
      expect(shown, 'seam revealed on row hover').toBe('1')
    })

    await test.step('seam-drag redistributes 6/6 → ~8/4', async () => {
      const sb = (await page.locator(seamSel).boundingBox())!
      const sx = sb.x + sb.width / 2
      const sy = sb.y + sb.height / 2
      await revealAt(sx, sy)
      await page.mouse.down()
      await page.mouse.move(sx + colW * 2, sy, { steps: 14 }) // drag right ~2 columns → 8/4
      await page.mouse.up()
      await page.waitForTimeout(400)
      const box0 = (await boxOf(b0))!
      const box1 = (await boxOf(b1))!
      expect(box0.width, 'left block grew').toBeGreaterThan(box1.width)
      expect(box0.width / box1.width, 'roughly 2:1 (8/4)').toBeGreaterThan(1.5)
    })

    await test.step('one undo reverts the seam-drag to 6/6', async () => {
      await dialog.locator('[aria-label="Undo"]').click()
      await page.waitForTimeout(300)
      const box0 = (await boxOf(b0))!
      const box1 = (await boxOf(b1))!
      expect(Math.abs(box0.width - box1.width), 'back to even 6/6').toBeLessThan(box0.width * 0.2)
    })

    await test.step('keyboard ArrowRight on the seam grows the left block (aria-valuenow=8)', async () => {
      const seam = page.locator(seamSel)
      await seam.focus() // focus reveals it (focusedRowId)
      await page.waitForTimeout(160)
      const before = (await boxOf(b0))!.width
      await seam.press('ArrowRight')
      await seam.press('ArrowRight')
      await page.waitForTimeout(260)
      const after = (await boxOf(b0))!.width
      expect(after, 'ArrowRight x2 widened the left block').toBeGreaterThan(before)
      expect(await seam.getAttribute('aria-valuenow'), 'splitter now at column 8').toBe('8')
    })

    await test.step('Escape cancels a live seam-drag; the modal stays open', async () => {
      await dialog.locator('[aria-label="Undo"]').click() // revert the 2 keyboard nudges to 6/6
      await dialog.locator('[aria-label="Undo"]').click()
      await page.waitForTimeout(300)
      const before = (await boxOf(b0))!.width
      const sb = (await page.locator(seamSel).boundingBox())!
      const sx = sb.x + sb.width / 2
      const sy = sb.y + sb.height / 2
      await revealAt(sx, sy)
      await page.mouse.down()
      await page.mouse.move(sx + colW * 2, sy, { steps: 10 }) // preview a resize
      await page.keyboard.press('Escape') // must cancel the drag, NOT close the Radix dialog
      await page.waitForTimeout(260)
      await page.mouse.up()
      await page.waitForTimeout(200)
      expect(await dialog.isVisible(), 'Escape cancelled the drag without closing the modal').toBe(true)
      const after = (await boxOf(b0))!.width
      expect(Math.abs(after - before), 'preview reverted (<1 column drift)').toBeLessThan(colW)
    })

    expect(
      realConsoleIssues(consoleIssues),
      `unexpected v2 console/page issues: ${JSON.stringify(consoleIssues, null, 2)}`,
    ).toEqual([])
  })
})
