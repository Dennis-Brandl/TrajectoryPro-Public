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
// Real-browser coverage for the v2 form designer's P3.4 Edit⇄Preview run mode:
// toggling mounts the real @mission/form-renderer in mode="run" behind the Designer
// preview host; typing persists through the controlled host; Restart remounts and clears;
// Edit restores the authoring surface. Interactive run-mode controls + controlled-value
// round-trips are outside jsdom's reach, so this lives as a Chromium E2E.

import { test, expect, type Page, type ConsoleMessage } from '@playwright/test'
import { ADMIN_STORAGE_STATE } from './helpers/session'
import { dragStepFromPalette } from './helpers/drag'
import { paletteItem } from './helpers/selectors'

const DROP_EFFECT_ARTIFACT = /dropEffect/

function trackConsole(page: Page): string[] {
  const bucket: string[] = []
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' || msg.type() === 'warning') bucket.push(`[console.${msg.type()}] ${msg.text()}`)
  })
  page.on('pageerror', (err) => bucket.push(`[pageerror] ${err.message}`))
  return bucket
}
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
async function addUserInteractionNode(page: Page): Promise<void> {
  await dragStepFromPalette(page, paletteItem(page, 'User Interaction'), 'userInteractionStep')
  await expect(page.locator('.react-flow__node')).toHaveCount(1, { timeout: 8_000 })
}

test.describe('v2 form designer — run-mode preview (real-browser)', () => {
  test.use({ storageState: ADMIN_STORAGE_STATE, viewport: { width: 1920, height: 1080 } })

  test('Edit⇄Preview drives the interactive run renderer', async ({ page }) => {
    test.setTimeout(120_000)
    const consoleIssues = trackConsole(page)
    await setupAndLogin(page, `V2 Preview Lib ${Date.now()}`, `V2 Preview Wf ${Date.now()}`)
    await addUserInteractionNode(page)

    const dialog = page.locator('[aria-label="Form Designer (v2)"]')
    await page.locator('.react-flow__node').first().dblclick()
    await expect(dialog).toBeVisible({ timeout: 8_000 })

    await page.locator('[data-palette-drag="palette:textInput"]').click()
    await expect(page.locator('[data-block-id]')).toHaveCount(1, { timeout: 8_000 })

    await test.step('toggle Preview: palette/inspector hide, run renderer appears', async () => {
      await page.getByRole('button', { name: 'Preview' }).click()
      await expect(page.getByTestId('preview-frame')).toBeVisible({ timeout: 8_000 })
      await expect(page.getByTestId('preview-decision-bar')).toBeVisible()
      await expect(page.locator('[data-palette-drag]')).toHaveCount(0)
      await expect(page.getByTestId('inspector-slot')).toHaveCount(0)
    })

    await test.step('run renderer is interactive: typing persists through the host', async () => {
      const input = page.getByTestId('preview-frame').locator('input').first()
      await input.fill('SN-123')
      await expect(input).toHaveValue('SN-123')
    })

    await test.step('Restart resets the run field', async () => {
      await page.getByRole('button', { name: 'Restart preview' }).click()
      await expect(page.getByTestId('preview-frame').locator('input').first()).toHaveValue('')
    })

    await test.step('toggle back to Edit restores authoring', async () => {
      await page.getByRole('button', { name: 'Edit' }).click()
      await expect(page.getByTestId('bp-frame')).toBeVisible()
      await expect(page.locator('[data-palette-drag]').first()).toBeVisible()
    })

    expect(
      realConsoleIssues(consoleIssues),
      `unexpected v2 preview console/page issues: ${JSON.stringify(consoleIssues, null, 2)}`,
    ).toEqual([])
  })
})
