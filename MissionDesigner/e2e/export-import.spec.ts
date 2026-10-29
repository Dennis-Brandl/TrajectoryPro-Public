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

import {
  test,
  expect,
  request as pwRequest,
  type Page,
  type BrowserContext,
  type APIRequestContext,
} from '@playwright/test'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { ADMIN_STORAGE_STATE, loadAdminState } from './helpers/session'
import { createLibrary } from './helpers/admin'
import { openWritableDb, seedRootSpec } from './helpers/seed'
import { seedFromWflibx } from './helpers/seed-library'

/**
 * Export / Import round-trip tests.
 *
 * Export notes:
 *  - The ExportMenu is a dropdown with "Export" button (Download icon).
 *  - In workflow mode, it shows: "Export as Workflow ZIP", "Export as PNG Workflow", "Export as SVG Workflow".
 *  - The ImportButton shows "Import Workflow" with an Upload icon.
 *  - Workflow export format: .WFmasterX (ZIP file containing JSON + images/).
 *  - Library export format: .WFlibX (JSON for workflow libraries).
 *
 * Playwright download handling:
 *  - Use page.waitForEvent('download') to capture file downloads.
 *  - Use page.setInputFiles() to simulate file uploads.
 *
 * TODO: The SpecificationHeader (where Export/Import buttons live) needs to be
 *       visible — this requires a workflow spec to be selected.
 */

async function setupAndLogin(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.getByRole('tab', { name: 'Workflows' })).toBeVisible({ timeout: 15_000 })

  // Create a workflow library and a specification
  await page.getByRole('button', { name: 'New Library' }).click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await page.getByRole('alertdialog').getByRole('textbox').fill('Export Test Library')
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByText('Export Test Library').first()).toBeVisible({ timeout: 8_000 })

  const libraryRow = page.getByText('Export Test Library').first().locator('..')
  await libraryRow.hover()
  await libraryRow.locator('button').filter({ hasText: '' }).last().click()
  await page.getByRole('menuitem', { name: 'Add Workflow' }).click()
  await page.getByRole('alertdialog').getByRole('textbox').fill('Export Test Workflow')
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByText('Export Test Workflow').first()).toBeVisible({ timeout: 8_000 })

  // Select the spec to activate the canvas and header toolbar
  await page.getByText('Export Test Workflow').first().click()
  await expect(page.locator('.react-flow')).toBeVisible({ timeout: 8_000 })
}

test.describe('Export and Import', () => {
  test.use({ storageState: ADMIN_STORAGE_STATE })

  test.beforeEach(async ({ page }) => {
    await setupAndLogin(page)
  })

  test('Export dropdown button is visible when a workflow is selected', async ({ page }) => {
    // The canvas toolbar ExportMenu renders an "Export" button (Download icon) inside .react-flow.
    // Scope to the canvas area to avoid matching the sidebar's library Export button.
    await expect(page.getByTestId('canvas-toolbar').getByRole('button', { name: /Export/i })).toBeVisible({
      timeout: 8_000,
    })
  })

  test('Export dropdown shows workflow export options', async ({ page }) => {
    // Scope to canvas toolbar to open the workflow export dropdown (not the sidebar library export).
    const exportBtn = page.getByTestId('canvas-toolbar').getByRole('button', { name: /Export/i })
    await exportBtn.click()

    // In workflow mode, the dropdown shows ZIP and image options
    await expect(page.getByRole('menuitem', { name: /Export as Workflow ZIP/i })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /Export as PNG/i })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /Export as SVG/i })).toBeVisible()
  })

  test('Import Workflow button is visible', async ({ page }) => {
    // The ImportButton in the library sidebar renders "Import Library" in workflow mode
    // (UI drift: was "Import Workflow", now "Import Library" per ImportButton component).
    await expect(page.getByRole('button', { name: /Import Library/i })).toBeVisible({
      timeout: 8_000,
    })
  })
})

// =============================================================================
// Workflow export downloads (.WFmasterX ZIP + PNG/SVG image)
//
// These need a NON-EMPTY, VALID workflow: ZIP export runs client-side
// validation (requires a Start node), and image export guards `nodes.length`.
// We seed a minimal Start→End workflow straight into the e2e DB (the v2 API has
// no "create spec content" endpoint) and drive the real export UI.
// =============================================================================

const DL_LIB = 'Export DL Lib'
const DL_WF = 'Export DL WF'
const IMPORT_LIB = 'Import Target Lib'
const VALID_WF_DATA = {
  nodes: [
    { id: 'n-start', type: 'start', position: { x: 100, y: 100 }, data: { stepType: 'start', label: 'Start' } },
    { id: 'n-end', type: 'end', position: { x: 100, y: 250 }, data: { stepType: 'end', label: 'End' } },
  ],
  edges: [{ id: 'e1', source: 'n-start', target: 'n-end' }],
}

/** Reveal a library's spec rows. Scope Expand to the library's own treeitem (strict-mode safe); idempotent. */
async function expandTheLibrary(page: Page, libName: string): Promise<void> {
  const row = page.locator('[role="treeitem"]').filter({ has: page.getByText(libName, { exact: true }) })
  await expect(row).toBeVisible({ timeout: 8_000 })
  const expand = row.getByRole('button', { name: 'Expand' })
  if (await expand.isVisible().catch(() => false)) await expand.click()
}

function specRow(page: Page, name: string) {
  return page.locator('[data-testid="spec-tree-row"]').filter({ has: page.getByText(name, { exact: true }) })
}

/** Open a library row's "Library actions" menu (the trigger is opacity-0 until row hover). */
async function openLibraryActions(page: Page, libName: string): Promise<void> {
  const row = page.locator('[role="treeitem"]').filter({ has: page.getByText(libName, { exact: true }) })
  await expect(row).toBeVisible({ timeout: 8_000 })
  await row.hover()
  await row.getByRole('button', { name: 'Library actions' }).click()
}

test.describe.serial('Workflow export downloads', () => {
  test.use({ storageState: ADMIN_STORAGE_STATE })

  // Seed once: a workflow library (real API) + a valid Start→End root spec (direct DB).
  test.beforeAll(async () => {
    const { defaultTeamId } = loadAdminState()
    const adminReq = await pwRequest.newContext({ storageState: ADMIN_STORAGE_STATE })
    let libId: string
    try {
      libId = (await createLibrary(adminReq, { name: DL_LIB, entityType: 'workflow', teamId: defaultTeamId })).id
      // Fresh empty target library for the export→import round-trip test.
      await createLibrary(adminReq, { name: IMPORT_LIB, entityType: 'workflow', teamId: defaultTeamId })
    } finally {
      await adminReq.dispose()
    }
    const db = openWritableDb()
    try {
      await seedRootSpec(db, { libraryId: libId, name: DL_WF, state: 'Draft', data: VALID_WF_DATA })
    } finally {
      await db.end()
    }
  })

  // Open the seeded workflow on the canvas. The node-count assertion is the
  // hydration de-risk: if seeded data.nodes don't render, every test fails here.
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('tab', { name: 'Workflows' })).toBeVisible({ timeout: 15_000 })
    await expandTheLibrary(page, DL_LIB)
    await specRow(page, DL_WF).getByText(DL_WF, { exact: true }).click()
    await expect(page.locator('.react-flow')).toBeVisible({ timeout: 8_000 })
    await expect(page.locator('.react-flow__node')).toHaveCount(2, { timeout: 8_000 })
  })

  test('Export as Workflow ZIP downloads a .WFmasterX file', async ({ page }) => {
    // Scope to the canvas toolbar Export (the sidebar has its own ExportMenu).
    const exportBtn = page.getByTestId('canvas-toolbar').getByRole('button', { name: /Export/i })
    await exportBtn.click()

    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('menuitem', { name: /Export as Workflow ZIP/i }).click()

    const download = await downloadPromise
    const filename = download.suggestedFilename()
    expect(filename).toMatch(/\.WFmasterX$/i)

    const tmpPath = path.join(os.tmpdir(), filename)
    await download.saveAs(tmpPath)
    expect(fs.statSync(tmpPath).size).toBeGreaterThan(0)
    fs.unlinkSync(tmpPath)
  })

  test('Export as PNG Workflow triggers a download', async ({ page }) => {
    const exportBtn = page.getByTestId('canvas-toolbar').getByRole('button', { name: /Export/i })
    await exportBtn.click()

    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('menuitem', { name: /Export as PNG/i }).click()

    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/\.png$/i)
  })

  test('Export as SVG Workflow triggers a download', async ({ page }) => {
    const exportBtn = page.getByTestId('canvas-toolbar').getByRole('button', { name: /Export/i })
    await exportBtn.click()

    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('menuitem', { name: /Export as SVG/i }).click()

    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/\.svg$/i)
  })

  test('export → import round-trips the workflow into a new library', async ({ page }) => {
    // beforeEach already opened DL_WF (Start→End, 2 nodes). 1) Export it to a temp file.
    const exportBtn = page.getByTestId('canvas-toolbar').getByRole('button', { name: /Export/i })
    await exportBtn.click()
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('menuitem', { name: /Export as Workflow ZIP/i }).click()
    const download = await downloadPromise
    const tmpPath = path.join(os.tmpdir(), download.suggestedFilename())
    await download.saveAs(tmpPath)

    // 2) Import the .WFmasterX into the fresh IMPORT_LIB (created empty in beforeAll, so it's
    //    already in the sidebar — no reload, which would trigger the draft-recovery modal).
    //    The importer mints new ids, so there's no OID clash with the source workflow.
    await openLibraryActions(page, IMPORT_LIB)
    const fileChooserPromise = page.waitForEvent('filechooser')
    await page.getByRole('menuitem', { name: /Import Workflow Package/i }).click()
    const fileChooser = await fileChooserPromise
    await fileChooser.setFiles(tmpPath)

    // 3) The handler auto-opens the imported workflow → its Start+End nodes render.
    await expect(page.getByText(/Imported runtime package/i)).toBeVisible({ timeout: 12_000 })
    await expect(page.locator('.react-flow__node')).toHaveCount(2, { timeout: 12_000 })

    fs.unlinkSync(tmpPath)
  })
})

// =============================================================================
// Workflow Library round-trip (.WFlibX) tests
// =============================================================================

/**
 * Helper: navigate to the Workflows tab and ensure it is active.
 */
async function goToWorkflowsTab(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Workflows' }).click()
  await expect(page.getByRole('tab', { name: 'Workflows' })).toHaveAttribute('aria-selected', 'true', {
    timeout: 6_000,
  })
}

/**
 * Helper: select an existing library row by name so the Export button is enabled.
 */
async function selectLibraryByName(page: Page, name: string): Promise<void> {
  const row = page.getByText(name, { exact: false })
  await expect(row).toBeVisible({ timeout: 10_000 })
  await row.click()
}

/**
 * Helper: trigger the hidden file input for ".WFlibX" import.
 * The ImportButton component renders a visually hidden <input type="file" accept=".WFlibX">.
 */
async function importWfLibX(page: Page, filePath: string): Promise<void> {
  const fileInput = page
    .locator('input[type="file"]')
    .filter({ hasNot: page.locator('[accept=".WFmasterX"]') })
    .first()
  await fileInput.setInputFiles(filePath)
}

interface WfLibXSuiteState {
  failed: boolean
}

const wfState: WfLibXSuiteState = { failed: false }

function skipIfWfFailed() {
  test.skip(wfState.failed, 'Previous test failed — skipping downstream tests')
}

test.describe.serial('Workflow Library .WFlibX round-trip', () => {
  let sharedContext: BrowserContext
  let sharedPage: Page

  test.beforeAll(async ({ browser }) => {
    sharedContext = await browser.newContext({ storageState: ADMIN_STORAGE_STATE })
    sharedPage = await sharedContext.newPage()
    await sharedPage.setViewportSize({ width: 1440, height: 900 })
    await sharedPage.goto('/')
    await expect(sharedPage.getByRole('tab', { name: 'Workflows' })).toBeVisible({ timeout: 15_000 })
  })

  test.afterAll(async () => {
    if (sharedPage) await sharedPage.close()
    if (sharedContext) await sharedContext.close()
  })

  test('round-trip: export then re-import → "Nothing to import" info toast', async () => {
    skipIfWfFailed()
    try {
      await goToWorkflowsTab(sharedPage)

      // Create a new workflow library.
      await sharedPage.getByRole('button', { name: 'New Library' }).click()
      const createDialog = sharedPage.getByRole('alertdialog')
      await expect(createDialog).toBeVisible({ timeout: 8_000 })
      await createDialog.getByRole('textbox').fill('RoundTrip Library')
      await sharedPage.getByRole('button', { name: 'Create' }).click()
      await expect(sharedPage.getByText('RoundTrip Library')).toBeVisible({ timeout: 10_000 })

      // Select the library to enable the Export button.
      await selectLibraryByName(sharedPage, 'RoundTrip Library')

      // Export the library package (.WFlibX).
      const exportBtn = sharedPage.getByRole('button', { name: /Export/i }).first()
      await expect(exportBtn).toBeEnabled({ timeout: 6_000 })
      await exportBtn.click()
      const downloadPromise = sharedPage.waitForEvent('download')
      await sharedPage.getByRole('menuitem', { name: /Export Library Package/i }).click()
      const download = await downloadPromise
      expect(download.suggestedFilename()).toMatch(/\.WFlibX$/i)

      // Save to temp dir for re-import.
      const tmpFile = path.join(os.tmpdir(), download.suggestedFilename())
      await download.saveAs(tmpFile)
      expect(fs.statSync(tmpFile).size).toBeGreaterThan(0)

      // Re-import the same file — every OID is already in the DB → "Nothing to import".
      await importWfLibX(sharedPage, tmpFile)
      await expect(
        sharedPage.getByText(/Nothing to import/i),
        'Expected "Nothing to import" info toast after round-trip import',
      ).toBeVisible({ timeout: 12_000 })

      fs.unlinkSync(tmpFile)
    } catch (err) {
      wfState.failed = true
      throw err
    }
  })

  /** Remove the seeded library (and, by cascade, its specs) so each test starts from a clean seed. */
  async function dropSeedLibrary(): Promise<void> {
    const db = openWritableDb()
    try {
      await db.query(`DELETE FROM "library" WHERE "name" IN ('Conflict Seed Library', 'Brand New Library')`)
    } finally {
      await db.end()
    }
  }

  async function seedConflictLibrary(): Promise<{ api: APIRequestContext; specId: string }> {
    const { storageState, defaultTeamId } = loadAdminState()
    const api = await pwRequest.newContext({ storageState })
    await dropSeedLibrary()
    await seedFromWflibx(api, path.resolve('test-data/conflict-seed.WFlibX'), defaultTeamId)
    const db = openWritableDb()
    try {
      const { rows } = await db.query(`SELECT "id" FROM "specification" WHERE "name" = 'Conflict Workflow'`)
      expect(rows).toHaveLength(1)
      return { api, specId: rows[0].id as string }
    } finally {
      await db.end()
    }
  }

  async function specState(specId: string): Promise<string | undefined> {
    const db = openWritableDb()
    try {
      const { rows } = await db.query(`SELECT "state" FROM "specification" WHERE "id" = $1`, [specId])
      return rows[0]?.state as string | undefined
    } finally {
      await db.end()
    }
  }

  test('conflict-heavy: seed → import conflict bundle → dialog opens → Replace all → success', async () => {
    const { api } = await seedConflictLibrary()
    await api.dispose()
    await sharedPage.reload()
    await goToWorkflowsTab(sharedPage)

    await importWfLibX(sharedPage, path.resolve('test-data/conflict-heavy.WFlibX'))
    const dialog = sharedPage.getByRole('dialog')
    await expect(dialog.getByText(/Import workflow library/)).toBeVisible({ timeout: 12_000 })
    await dialog.getByRole('button', { name: 'Replace all with imported' }).click()
    await dialog.getByRole('button', { name: 'Import', exact: true }).click()
    await expect(sharedPage.getByText(/Imported "Conflict Seed Library"/)).toBeVisible({ timeout: 12_000 })

    await dropSeedLibrary()
  })

  test('a released spec in an import is refused and the rest imports', async () => {
    const { api, specId } = await seedConflictLibrary()
    const released = await api.patch(`http://localhost:3001/api/v2/specifications/${specId}/state`, {
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5174' },
      data: { newState: 'Effective', reason: 'e2e release', effectiveFrom: Date.now() },
    })
    expect(released.ok(), await released.text()).toBe(true)
    await api.dispose()
    expect(await specState(specId)).toBe('Effective')
    await sharedPage.reload()
    await goToWorkflowsTab(sharedPage)

    await importWfLibX(sharedPage, path.resolve('test-data/conflict-heavy.WFlibX'))
    const dialog = sharedPage.getByRole('dialog')
    await expect(dialog.getByText(/Import workflow library/)).toBeVisible({ timeout: 12_000 })
    await expect(dialog.getByText('Released — will not be replaced').first()).toBeVisible()
    // Every conflict row is refused (the library Replace would delete the released spec), so no
    // Replace choice is left to make: the bulk buttons are gone and Import is already enabled.
    await expect(dialog.getByRole('button', { name: 'Replace all with imported' })).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Import', exact: true }).click()

    const report = sharedPage.getByRole('dialog').filter({ hasText: 'Import complete' })
    await expect(report).toBeVisible({ timeout: 12_000 })
    await expect(report.getByText('Released — will not be replaced').first()).toBeVisible()
    await expect(report.getByText(/Conflict Workflow/).first()).toBeVisible()
    await report.getByRole('button').last().click()

    expect(await specState(specId)).toBe('Effective')
    await dropSeedLibrary()
  })
})
