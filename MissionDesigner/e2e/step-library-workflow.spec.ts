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

import { test, expect, type Page, type BrowserContext } from '@playwright/test'
import { CURRENT_DATA_SCHEMA_VERSION } from '../src/lib/data-schema-version'
import { openDb, closeDb } from './helpers/db'
import { loadAdminState, ADMIN_STORAGE_STATE } from './helpers/session'
import { LIBRARY_NAMES, SUB_LIBRARY_NAME, workflowName, childName } from './helpers/fixtures'

/**
 * End-to-end lifecycle test for Step Libraries and Step Workflows.
 *
 * Creates 3 step libraries, 3 workflows per library, 3 levels of nested children
 * per workflow, populates parameters/resources, runs CRUD, and verifies
 * Postgres DB matches the UI at every write.
 *
 * See design doc: docs/superpowers/specs/2026-04-17-step-library-workflow-e2e-design.md
 */

// Shared state across serial tests.
interface SuiteState {
  teamId: string // the team libraries are created in — the scope for DB assertions
  failed: boolean
  libraryIds: Map<string, string> // name -> id
  specIds: Map<string, string> // name -> id (workflow + child names)
}

const state: SuiteState = {
  teamId: '',
  failed: false,
  libraryIds: new Map(),
  specIds: new Map(),
}

function skipIfFailed() {
  test.skip(state.failed, 'Previous test failed — skipping downstream tests')
}

/**
 * The root Workflow Properties panel renders Inputs/Outputs/Values/Resources as
 * collapsed accordion sections (WorkflowInlineEditor, Accordion defaultValue=[]).
 * Expand one by clicking its header — unless its add-button is already visible
 * (sections persist open across workflow switches, so this stays idempotent).
 */
async function expandPropertySection(page: Page, header: string, addButton: string): Promise<void> {
  const add = page.getByRole('button', { name: addButton })
  if (await add.isVisible().catch(() => false)) return
  await page.getByRole('button', { name: header }).click()
  await expect(add).toBeVisible({ timeout: 5_000 })
}

test.describe.serial('Step Library & Step Workflow E2E', () => {
  let sharedContext: BrowserContext
  let sharedPage: Page

  test.beforeAll(async ({ browser }) => {
    // Reuse the admin bootstrapped by global-setup.ts; libraries are created in
    // its default team (the only team this admin is eligible to create in, so the
    // CreateLibraryDialog hides its team picker and uses it implicitly).
    state.teamId = loadAdminState().defaultTeamId

    sharedContext = await browser.newContext({ storageState: ADMIN_STORAGE_STATE })
    sharedPage = await sharedContext.newPage()
    await sharedPage.setViewportSize({ width: 1440, height: 900 })

    // Verify the DB handle opens
    openDb()

    // Navigate to the root — we should land on the main editor authenticated.
    await sharedPage.goto('/')
    await expect(sharedPage.getByRole('tab', { name: 'Steps' })).toBeVisible({ timeout: 10_000 })
  })

  test.afterAll(async () => {
    await closeDb()
    if (sharedPage) await sharedPage.close()
    if (sharedContext) await sharedContext.close()
  })

  test('Phase A1: create 3 step libraries', async () => {
    skipIfFailed()
    try {
      await sharedPage.getByRole('tab', { name: 'Steps' }).click()

      for (const libName of LIBRARY_NAMES) {
        await sharedPage.getByRole('button', { name: 'New Library' }).click()
        const dialog = sharedPage.getByRole('alertdialog')
        await expect(dialog).toBeVisible()
        await expect(sharedPage.getByText('Create Step Library')).toBeVisible()
        await dialog.getByRole('textbox').fill(libName)
        await sharedPage.getByRole('button', { name: 'Create' }).click()
        await expect(dialog).not.toBeVisible()
        await expect(sharedPage.getByText(libName, { exact: true })).toBeVisible({ timeout: 8_000 })

        // DB verification
        const db = openDb()
        const row = (
          await db.query(
            `SELECT id, "teamId", "parentLibraryId", name, "entityType", version
               FROM library WHERE "teamId" = $1 AND name = $2 AND "entityType" = 'step'`,
            [state.teamId, libName],
          )
        ).rows[0] as
          | {
              id: string
              teamId: string
              parentLibraryId: string | null
              name: string
              entityType: string
              version: string
            }
          | undefined

        expect(row, `library '${libName}' should exist in DB`).toBeDefined()
        expect(row!.teamId).toBe(state.teamId)
        expect(row!.parentLibraryId).toBeNull()
        expect(row!.entityType).toBe('step')
        expect(row!.version).toBe('1.0.0')

        state.libraryIds.set(libName, row!.id)
      }

      expect(state.libraryIds.size).toBe(3)
    } catch (err) {
      state.failed = true
      throw err
    }
  })

  test('Phase A2: library detail form saves description and author', async () => {
    skipIfFailed()
    try {
      const libName = LIBRARY_NAMES[0]
      await sharedPage.getByText(libName, { exact: true }).click()
      await expect(sharedPage.getByLabel('Library Description')).toBeVisible({ timeout: 8_000 })

      const description = 'E2E test description for library 1'
      const author = 'E2E Test Suite'

      await sharedPage.getByLabel('Library Description').fill(description)
      await sharedPage.getByLabel('Author').fill(author)
      const saveBtn = sharedPage.getByRole('button', { name: /^Save$/ })
      await expect(saveBtn).toBeEnabled()

      const saveResponse = sharedPage.waitForResponse(
        (r) => r.url().includes('/api/v2/libraries/') && r.request().method() === 'PATCH' && r.ok(),
        { timeout: 8_000 },
      )
      await saveBtn.click()
      await saveResponse
      await expect(saveBtn).toBeDisabled({ timeout: 5_000 })

      // DB verify
      const db = openDb()
      const libId = state.libraryIds.get(libName)!
      const row = (await db.query(`SELECT description, author FROM library WHERE id = $1`, [libId])).rows[0] as {
        description: string | null
        author: string | null
      }
      expect(row.description).toBe(description)
      expect(row.author).toBe(author)

      // Reload page, verify UI re-renders from server state
      await sharedPage.reload()
      await sharedPage.getByRole('tab', { name: 'Steps' }).click()
      await sharedPage.getByText(libName, { exact: true }).click()
      await expect(sharedPage.getByLabel('Library Description')).toHaveValue(description)
      await expect(sharedPage.getByLabel('Author')).toHaveValue(author)
    } catch (err) {
      state.failed = true
      throw err
    }
  })

  test('Phase A3: create a sub-library under library 1', async () => {
    skipIfFailed()
    try {
      const parentName = LIBRARY_NAMES[0]
      const parentRow = sharedPage.getByRole('tree').getByRole('treeitem').filter({ hasText: parentName }).first()
      await parentRow.hover()
      await sharedPage.waitForTimeout(100)
      // The context menu button is the last button inside the treeitem row
      const menuBtn = parentRow.locator('button').last()
      await menuBtn.click()

      await sharedPage.getByRole('menuitem', { name: 'Add Sub-Library' }).click()

      const dialog = sharedPage.getByRole('alertdialog')
      await expect(dialog).toBeVisible()
      await dialog.getByRole('textbox').fill(SUB_LIBRARY_NAME)
      await sharedPage.getByRole('button', { name: 'Create' }).click()
      await expect(dialog).not.toBeVisible()
      await expect(
        sharedPage.getByRole('tabpanel', { name: 'step libraries' }).getByText(SUB_LIBRARY_NAME, { exact: true }),
      ).toBeVisible({ timeout: 8_000 })

      // DB verify
      const db = openDb()
      const parentId = state.libraryIds.get(parentName)!
      const row = (
        await db.query(
          `SELECT id, "parentLibraryId", "entityType" FROM library
            WHERE "teamId" = $1 AND name = $2 AND "parentLibraryId" = $3`,
          [state.teamId, SUB_LIBRARY_NAME, parentId],
        )
      ).rows[0] as { id: string; parentLibraryId: string; entityType: string } | undefined

      expect(row, 'sub-library should exist with parentLibraryId set').toBeDefined()
      expect(row!.parentLibraryId).toBe(parentId)
      expect(row!.entityType).toBe('step')

      state.libraryIds.set(SUB_LIBRARY_NAME, row!.id)
    } catch (err) {
      state.failed = true
      throw err
    }
  })

  test('Phase B: create 9 root step workflows across 3 libraries', async () => {
    test.setTimeout(90_000)
    skipIfFailed()
    try {
      const ADD_STEP_LABEL = 'Add Step Workflow'

      for (let libIdx = 1; libIdx <= 3; libIdx++) {
        const libName = LIBRARY_NAMES[libIdx - 1]
        const libId = state.libraryIds.get(libName)!
        const libRow = sharedPage.getByRole('tree').getByRole('treeitem').filter({ hasText: libName }).first()

        for (let wfIdx = 1; wfIdx <= 3; wfIdx++) {
          const wfName = workflowName(libIdx, wfIdx)

          await libRow.hover()
          await sharedPage.waitForTimeout(100)
          const menuBtn = libRow.locator('button').last()
          await menuBtn.click()
          await sharedPage.getByRole('menuitem', { name: ADD_STEP_LABEL }).click()

          const dialog = sharedPage.getByRole('alertdialog')
          await expect(dialog).toBeVisible()
          await dialog.getByRole('textbox').fill(wfName)
          await sharedPage.getByRole('button', { name: 'Create' }).click()
          await expect(dialog).not.toBeVisible()
          await expect(
            sharedPage.getByRole('tabpanel', { name: 'step libraries' }).getByText(wfName, { exact: true }),
          ).toBeVisible({ timeout: 8_000 })

          // DB verify
          const db = openDb()
          const row = (
            await db.query(
              `SELECT id, "libraryId", name, "parentSpecificationId", "rootSpecificationId",
                      state, "dataSchemaVersion", data
                 FROM specification
                WHERE "libraryId" = $1 AND name = $2`,
              [libId, wfName],
            )
          ).rows[0] as
            | {
                id: string
                libraryId: string
                name: string
                parentSpecificationId: string | null
                rootSpecificationId: string | null
                state: string
                dataSchemaVersion: number
                data: string
              }
            | undefined

          expect(row, `spec ${wfName} should exist`).toBeDefined()
          expect(row!.libraryId).toBe(libId)
          expect(row!.parentSpecificationId).toBeNull()
          expect(row!.rootSpecificationId).toBe(row!.id)
          expect(row!.state).toBe('Draft')
          expect(row!.dataSchemaVersion).toBe(CURRENT_DATA_SCHEMA_VERSION)
          expect(() => JSON.parse(row!.data)).not.toThrow()

          state.specIds.set(wfName, row!.id)
        }
      }

      expect(state.specIds.size).toBe(9)
    } catch (err) {
      state.failed = true
      throw err
    }
  })

  async function buildNestedChain(wfName: string): Promise<void> {
    await sharedPage.getByRole('tabpanel', { name: 'step libraries' }).getByText(wfName, { exact: true }).click()
    await expect(sharedPage.locator('.react-flow')).toBeVisible({ timeout: 8_000 })
    // Wait for any in-flight saves from the prior workflow to complete before dragging.
    // The Save button being disabled means there is no pending dirty state.
    await expect(sharedPage.getByRole('button', { name: 'Save' })).toBeDisabled({ timeout: 10_000 })

    const rootId = state.specIds.get(wfName)!
    let parentId = rootId
    let depthOffset = { x: 250, y: 200 }

    const { dragStepFromPalette } = await import('./helpers/drag')

    for (let depth = 1; depth <= 3; depth++) {
      // Prefix child names with the workflow name to avoid the unique (libraryId, name, version)
      // constraint being violated across workflows in the same library.
      const childLabel = `${wfName} ${childName(depth as 1 | 2 | 3)}`

      const paletteItem = sharedPage.getByText('Child Workflow', { exact: true }).first()
      await dragStepFromPalette(sharedPage, paletteItem, 'workflowProxy', depthOffset)

      const subDialog = sharedPage.getByRole('dialog', { name: 'Add Sub-Workflow' })
      await expect(subDialog).toBeVisible({ timeout: 5_000 })
      await subDialog.getByPlaceholder('Enter name...').fill(childLabel)

      // Set up the save response listener BEFORE clicking Create so we don't miss it
      const saveResponse = sharedPage.waitForResponse(
        (r) => r.url().includes('/api/v2/specifications/batch-save') && r.request().method() === 'POST' && r.ok(),
        { timeout: 10_000 },
      )
      await subDialog.getByRole('button', { name: 'Create' }).click()
      await expect(subDialog).not.toBeVisible()

      // Save synchronization (see Phase C1 commit for details)
      await saveResponse
      await expect(sharedPage.getByRole('button', { name: 'Save' })).toBeDisabled({ timeout: 8_000 })

      const db = openDb()
      const childRow = (
        await db.query(
          `SELECT id, name, "parentSpecificationId", "rootSpecificationId"
             FROM specification WHERE "parentSpecificationId" = $1 AND name = $2`,
          [parentId, childLabel],
        )
      ).rows[0] as { id: string; name: string; parentSpecificationId: string; rootSpecificationId: string } | undefined

      expect(childRow, `child ${childLabel} at depth ${depth} under ${wfName} should exist`).toBeDefined()
      expect(childRow!.parentSpecificationId).toBe(parentId)
      expect(childRow!.rootSpecificationId).toBe(rootId)

      state.specIds.set(`${wfName} / ${childName(depth as 1 | 2 | 3)}`, childRow!.id)

      if (depth < 3) {
        await sharedPage.locator(`[data-id]`, { hasText: childLabel }).first().dblclick()
        await sharedPage.waitForTimeout(500)
        parentId = childRow!.id
        depthOffset = { x: 250 + depth * 50, y: 200 + depth * 50 }
      }
    }

    const db = openDb()
    const subtree = (
      await db.query(
        `WITH RECURSIVE t(id, parent, depth) AS (
           SELECT id, "parentSpecificationId", 0 FROM specification WHERE id = $1
           UNION ALL
           SELECT s.id, s."parentSpecificationId", t.depth + 1
             FROM specification s JOIN t ON s."parentSpecificationId" = t.id
         )
         SELECT id, depth FROM t ORDER BY depth`,
        [rootId],
      )
    ).rows as Array<{ id: string; depth: number }>
    expect(subtree.length).toBe(4)
  }

  for (let libIdx = 1; libIdx <= 3; libIdx++) {
    for (let wfIdx = 1; wfIdx <= 3; wfIdx++) {
      const wfName = workflowName(libIdx, wfIdx)
      test(`Phase C: nested 3-deep children on ${wfName}`, async () => {
        test.setTimeout(90_000)
        skipIfFailed()
        try {
          await buildNestedChain(wfName)
        } catch (err) {
          state.failed = true
          throw err
        }
      })
    }
  }

  test('Phase D: populate full parameter variety on 9 root workflows', async () => {
    test.setTimeout(180_000) // ~9 specs × ~15s each ≈ 2-3 min
    skipIfFailed()
    try {
      // Inline fixture: full variety applied to every root workflow
      const rootFixture = {
        inputs: [
          { name: 'rootIn1', value: 'hello' },
          { name: 'rootIn2', value: '42' },
        ],
        outputs: [{ name: 'rootOut1' }, { name: 'rootOut2' }],
        values: [{ name: 'rootVal1' }],
        resources: [
          { name: 'r_single', resourceType: 'Single Use', count: 1 },
          { name: 'r_shared', resourceType: 'Shared Use', count: 3 },
          { name: 'r_count', resourceType: 'Count Limited', count: 5 },
          { name: 'r_named', resourceType: 'Named', count: 3, names: ['a', 'b', 'c'] as string[] },
          { name: 'r_sync', resourceType: 'Sync', count: 1 },
        ],
      }

      for (let libIdx = 1; libIdx <= 3; libIdx++) {
        for (let wfIdx = 1; wfIdx <= 3; wfIdx++) {
          const wfName = workflowName(libIdx, wfIdx)
          const specId = state.specIds.get(wfName)!

          // Navigate to the root workflow — click its name in the tree
          await sharedPage.getByRole('tabpanel', { name: 'step libraries' }).getByText(wfName, { exact: true }).click()
          await expect(sharedPage.locator('.react-flow')).toBeVisible({ timeout: 8_000 })
          // Click on an empty area of the canvas to deselect any selected node
          // so the Workflow Properties panel (root level) is shown, not a child node's panel.
          await sharedPage.locator('.react-flow__pane').click({ position: { x: 200, y: 100 } })
          // Root Workflow Properties panel is shown (its Name field appears). Its
          // parameter sections are collapsed accordions (WorkflowInlineEditor,
          // Accordion defaultValue=[]) — expand each before editing.
          await expect(sharedPage.getByPlaceholder('Workflow name...')).toBeVisible({ timeout: 8_000 })
          // Wait for any in-flight save from the prior workflow to complete
          await expect(sharedPage.getByRole('button', { name: 'Save' })).toBeDisabled({ timeout: 10_000 })
          await expandPropertySection(sharedPage, 'Input Parameters', 'Add input parameter')
          await expandPropertySection(sharedPage, 'Output Parameters', 'Add output parameter')
          await expandPropertySection(sharedPage, 'Value Properties', 'Add value property')
          await expandPropertySection(sharedPage, 'Resource Definitions', 'Add resource')

          // ── Inputs ──────────────────────────────────────────────────────────────
          // InputsEditor root: button's grandparent (button → header div → editor root)
          const addInputBtn = sharedPage.getByRole('button', { name: 'Add input parameter' })
          const inputsSection = addInputBtn.locator('../..')
          for (let i = 0; i < rootFixture.inputs.length; i++) {
            const inp = rootFixture.inputs[i]
            await addInputBtn.click()
            await inputsSection.getByPlaceholder('Name', { exact: true }).nth(i).fill(inp.name)
            await inputsSection.getByPlaceholder('Value', { exact: true }).nth(i).fill(inp.value)
          }

          // ── Outputs ─────────────────────────────────────────────────────────────
          // OutputsEditor: placeholder is "Parameter name"
          const addOutputBtn = sharedPage.getByRole('button', { name: 'Add output parameter' })
          const outputsSection = addOutputBtn.locator('../..')
          for (let i = 0; i < rootFixture.outputs.length; i++) {
            const out = rootFixture.outputs[i]
            await addOutputBtn.click()
            await outputsSection.getByPlaceholder('Parameter name').nth(i).fill(out.name)
          }

          // ── Values ──────────────────────────────────────────────────────────────
          // ValuesEditor: placeholder is "Property Name"
          const addValueBtn = sharedPage.getByRole('button', { name: 'Add value property' })
          const valuesSection = addValueBtn.locator('../..')
          for (let i = 0; i < rootFixture.values.length; i++) {
            const val = rootFixture.values[i]
            await addValueBtn.click()
            await valuesSection.getByPlaceholder('Property Name').nth(i).fill(val.name)
          }

          // ── Resources ───────────────────────────────────────────────────────────
          // ResourcesEditor root is the grandparent of the add button.
          // Each resource card is a direct child div of the root after the header div.
          // Card index i corresponds to child index (i + 1) of the root.
          const addResourceBtn = sharedPage.getByRole('button', { name: 'Add resource' })
          const resourcesSection = addResourceBtn.locator('../..')
          for (let i = 0; i < rootFixture.resources.length; i++) {
            const res = rootFixture.resources[i]
            await addResourceBtn.click()
            // Use exact: true to avoid matching "Name 1", "Name 2" etc. from Named resource entries
            await resourcesSection.getByPlaceholder('Name', { exact: true }).nth(i).fill(res.name)

            // Each resource card is a direct child of the resources section.
            // The header (with add button) is child index 0; resource cards start at index 1.
            // Use nth combobox within the section to select the right card's type dropdown.
            await resourcesSection.getByRole('combobox').nth(i).click()
            await sharedPage.getByRole('option', { name: res.resourceType, exact: true }).click()

            if (res.resourceType === 'Named' && res.names) {
              // After selecting 'Named', the card shows "Add Name" and "Name N" inputs.
              // There is only one Named resource so we can use page-level selectors scoped
              // to the nth combobox's ancestor card (the card containing combobox nth(i)).
              for (const nm of res.names) {
                // "Add Name" button is page-unique while Named is the only Named resource
                await sharedPage.getByRole('button', { name: 'Add Name' }).click()
                // Name inputs are labeled "Name 1", "Name 2", etc.; fill the last one
                await sharedPage
                  .getByPlaceholder(/^Name \d+$/)
                  .last()
                  .fill(nm)
              }
            } else if (res.resourceType === 'Shared Use' || res.resourceType === 'Count Limited') {
              // The count input is a sibling of the combobox within the same flex row.
              // Go up to the combobox's parent (the flex row div) then find the number input.
              await resourcesSection
                .getByRole('combobox')
                .nth(i)
                .locator('..')
                .locator('input[type="number"]')
                .fill(String(res.count))
            }
          }

          // Let the 300ms draft→flow-store debounce flush the final edit (the last
          // resource) before the explicit Save reads the store — otherwise batch-save
          // can persist one fewer resource than the UI shows (race seen on WF 1-2).
          await sharedPage.waitForTimeout(500)

          // ── Save ────────────────────────────────────────────────────────────────
          const saveResponse = sharedPage.waitForResponse(
            (r) => r.url().includes('/api/v2/specifications/batch-save') && r.request().method() === 'POST' && r.ok(),
            { timeout: 10_000 },
          )
          await sharedPage.getByRole('button', { name: 'Save' }).click()
          await saveResponse
          await expect(sharedPage.getByRole('button', { name: 'Save' })).toBeDisabled({ timeout: 8_000 })

          // ── DB Verify ───────────────────────────────────────────────────────────
          const db = openDb()
          const row = (await db.query(`SELECT data FROM specification WHERE id = $1`, [specId])).rows[0] as
            | { data: string }
            | undefined

          expect(row, `${wfName} DB row should exist`).toBeDefined()
          const parsed = JSON.parse(row!.data) as {
            workflowInputs?: Array<{ name: string; value?: string }>
            workflowOutputs?: Array<{ name: string }>
            workflowValues?: Array<{ name: string }>
            workflowResources?: Array<{ name: string; resourceType: string; count?: number; names?: string[] }>
            // Fallback keys (alternative serialization paths)
            inputs?: Array<{ name: string; value?: string }>
            outputs?: Array<{ name: string }>
            values?: Array<{ name: string }>
            resourceCommands?: Array<{ name: string }>
          }

          const inputs = parsed.workflowInputs ?? parsed.inputs ?? []
          const outputs = parsed.workflowOutputs ?? parsed.outputs ?? []
          const values = parsed.workflowValues ?? parsed.values ?? []
          const resources = parsed.workflowResources ?? parsed.resourceCommands ?? []

          expect(inputs.length, `${wfName} inputs count`).toBe(rootFixture.inputs.length)
          expect(outputs.length, `${wfName} outputs count`).toBe(rootFixture.outputs.length)
          expect(values.length, `${wfName} values count`).toBe(rootFixture.values.length)
          expect(resources.length, `${wfName} resources count`).toBe(rootFixture.resources.length)

          for (const inp of rootFixture.inputs) {
            expect(
              inputs.some((x) => x.name === inp.name),
              `input ${inp.name} in ${wfName}`,
            ).toBe(true)
          }
          for (const out of rootFixture.outputs) {
            expect(
              outputs.some((x) => x.name === out.name),
              `output ${out.name} in ${wfName}`,
            ).toBe(true)
          }
          for (const res of rootFixture.resources) {
            expect(
              resources.some((x) => x.name === res.name),
              `resource ${res.name} in ${wfName}`,
            ).toBe(true)
          }
          // Named resource should have its names array populated
          const namedRes = resources.find((x) => x.name === 'r_named') as { names?: string[] } | undefined
          if (namedRes) {
            expect(namedRes.names, `${wfName} named resource should have names array`).toEqual(['a', 'b', 'c'])
          }
        }
      }
    } catch (err) {
      state.failed = true
      throw err
    }
  })

  test('Phase E1: rename library 2', async () => {
    skipIfFailed()
    try {
      const oldName = LIBRARY_NAMES[1]
      const newName = `Renamed ${oldName}`

      const libRow = sharedPage.getByRole('tree').getByRole('treeitem').filter({ hasText: oldName }).first()
      await libRow.hover()
      await sharedPage.waitForTimeout(100)
      await libRow.locator('button').last().click()
      await sharedPage.getByRole('menuitem', { name: 'Rename' }).click()

      const dialog = sharedPage.getByRole('alertdialog')
      await expect(dialog).toBeVisible()
      const input = dialog.getByRole('textbox')
      await input.clear()
      await input.fill(newName)
      await sharedPage.getByRole('button', { name: 'Rename' }).click()
      await expect(dialog).not.toBeVisible()
      await expect(
        sharedPage.getByRole('tabpanel', { name: 'step libraries' }).getByText(newName, { exact: true }),
      ).toBeVisible({ timeout: 8_000 })

      // DB verify
      const db = openDb()
      const libId = state.libraryIds.get(oldName)!
      const row = (await db.query(`SELECT name FROM library WHERE id = $1`, [libId])).rows[0] as { name: string }
      expect(row.name).toBe(newName)

      // Keep the id indexed under the new name for downstream phases
      state.libraryIds.delete(oldName)
      state.libraryIds.set(newName, libId)
    } catch (err) {
      state.failed = true
      throw err
    }
  })

  test('Phase E2: rename root spec WF 3-1', async () => {
    skipIfFailed()
    try {
      const oldName = workflowName(3, 1)
      const newName = `${oldName} Renamed`
      const specId = state.specIds.get(oldName)!

      // Spec rename is done via the WorkflowInlineEditor Name field in the PropertiesPanel.
      // There is no context menu or inline-edit on the spec tree row — only a delete button.
      // Steps: select the spec row (loads canvas + properties panel), then edit the Name field.

      // Find and click the spec row to select it.
      // Note: SpecificationItem rows are plain divs (no role="treeitem") — locate by text
      // within the step libraries tabpanel.
      const row = sharedPage
        .getByRole('tabpanel', { name: 'step libraries' })
        .getByText(oldName, { exact: true })
        .first()
      await row.click()

      // Wait for the properties panel Name input to appear (WorkflowInlineEditor renders when spec is open)
      const nameInput = sharedPage.getByPlaceholder('Workflow name...')
      await expect(nameInput).toBeVisible({ timeout: 8_000 })

      // Clear and type the new name
      await nameInput.clear()
      await nameInput.fill(newName)

      // Wait for the 300ms debounce + updateInMemory to fire
      await sharedPage.waitForTimeout(500)

      // Save to DB via the Save button
      const saveResponse = sharedPage.waitForResponse(
        (r) => r.url().includes('/api/v2/specifications/batch-save') && r.request().method() === 'POST' && r.ok(),
        { timeout: 10_000 },
      )
      await sharedPage.getByRole('button', { name: 'Save' }).click()
      await saveResponse

      // DB verify — name column updated, rootSpecificationId must still equal the spec's own id
      const db = openDb()
      const dbRow = (await db.query(`SELECT name, "rootSpecificationId" FROM specification WHERE id = $1`, [specId]))
        .rows[0] as {
        name: string
        rootSpecificationId: string
      }
      expect(dbRow.name).toBe(newName)
      expect(dbRow.rootSpecificationId).toBe(specId) // root invariant

      state.specIds.delete(oldName)
      state.specIds.set(newName, specId)
    } catch (err) {
      state.failed = true
      throw err
    }
  })

  test('Phase F1: deleting a sub-workflow node cascades its embedded subtree', async () => {
    skipIfFailed()
    try {
      const wfName = workflowName(1, 1)
      const rootId = state.specIds.get(wfName)!
      const l1Key = `${wfName} / ${childName(1)}`
      const l2Key = `${wfName} / ${childName(2)}`
      const l3Key = `${wfName} / ${childName(3)}`
      const l1Id = state.specIds.get(l1Key)!
      const l2Id = state.specIds.get(l2Key)!
      const l3Id = state.specIds.get(l3Key)!
      const l1NodeLabel = `${wfName} ${childName(1)}` // node text, e.g. "WF 1-1 Child L1"

      // Open WF 1-1; its canvas shows the L1 sub-workflow proxy node.
      await sharedPage.getByRole('tabpanel', { name: 'step libraries' }).getByText(wfName, { exact: true }).click()
      await expect(sharedPage.locator('.react-flow')).toBeVisible({ timeout: 8_000 })
      await expect(sharedPage.getByRole('button', { name: 'Save' })).toBeDisabled({ timeout: 10_000 })

      // Delete the L1 sub-workflow node via its canvas context menu. Deleting an
      // embedded sub-workflow MUST cascade-delete its child spec subtree (L1→L2→L3),
      // never orphan it. The delete auto-saves (no explicit Save click needed).
      const l1Node = sharedPage.locator('[data-id]', { hasText: l1NodeLabel }).first()
      await expect(l1Node).toBeVisible({ timeout: 8_000 })
      const deleteResponse = sharedPage.waitForResponse(
        (r) => r.url().includes('/api/v2/specifications/batch-save') && r.request().method() === 'POST' && r.ok(),
        { timeout: 10_000 },
      )
      await l1Node.click({ button: 'right' })
      await sharedPage.getByRole('button', { name: 'Delete' }).click()
      await deleteResponse
      await expect(sharedPage.getByRole('button', { name: 'Save' })).toBeDisabled({ timeout: 8_000 })

      const db = openDb()
      // L1 and its descendants L2, L3 are gone — not orphaned in the DB.
      for (const [label, id] of [
        ['L1', l1Id],
        ['L2', l2Id],
        ['L3', l3Id],
      ] as const) {
        expect(
          (await db.query(`SELECT id FROM specification WHERE id = $1`, [id])).rows[0],
          `${label} cascade-deleted (not orphaned)`,
        ).toBeUndefined()
      }
      // The WF 1-1 root survives and nothing under it is orphaned (only the root remains).
      expect(
        (await db.query(`SELECT id FROM specification WHERE id = $1`, [rootId])).rows[0],
        'WF 1-1 root intact',
      ).toBeDefined()
      const subtree = (
        await db.query(`SELECT COUNT(*) as n FROM specification WHERE "rootSpecificationId" = $1`, [rootId])
      ).rows[0] as { n: number }
      expect(Number(subtree.n), 'only the WF 1-1 root remains in its subtree (no orphans)').toBe(1)

      // ── Undo/redo round-trip ────────────────────────────────────────────────
      // The delete was auto-saved (committed) above, so undo must RE-CREATE the
      // subtree (same ids), not merely un-mark it. Undo restores L1→L2→L3; redo
      // deletes them again. A fresh DB connection each step avoids stale reads.
      const undoSave = sharedPage.waitForResponse(
        (r) => r.url().includes('/api/v2/specifications/batch-save') && r.request().method() === 'POST' && r.ok(),
        { timeout: 12_000 },
      )
      await sharedPage.getByRole('button', { name: 'Undo (Ctrl+Z)' }).click()
      await undoSave
      await expect(sharedPage.getByRole('button', { name: 'Save' })).toBeDisabled({ timeout: 8_000 })

      await closeDb()
      const dbUndo = openDb()
      for (const [label, id] of [
        ['L1', l1Id],
        ['L2', l2Id],
        ['L3', l3Id],
      ] as const) {
        expect(
          (await dbUndo.query(`SELECT id FROM specification WHERE id = $1`, [id])).rows[0],
          `${label} restored by undo (round-trip, re-created server-side)`,
        ).toBeDefined()
      }

      const redoSave = sharedPage.waitForResponse(
        (r) => r.url().includes('/api/v2/specifications/batch-save') && r.request().method() === 'POST' && r.ok(),
        { timeout: 12_000 },
      )
      await sharedPage.getByRole('button', { name: 'Redo (Ctrl+Shift+Z)' }).click()
      await redoSave
      await expect(sharedPage.getByRole('button', { name: 'Save' })).toBeDisabled({ timeout: 8_000 })

      await closeDb()
      const dbRedo = openDb()
      for (const [label, id] of [
        ['L1', l1Id],
        ['L2', l2Id],
        ['L3', l3Id],
      ] as const) {
        expect(
          (await dbRedo.query(`SELECT id FROM specification WHERE id = $1`, [id])).rows[0],
          `${label} deleted again by redo`,
        ).toBeUndefined()
      }

      state.specIds.delete(l1Key)
      state.specIds.delete(l2Key)
      state.specIds.delete(l3Key)
    } catch (err) {
      state.failed = true
      throw err
    }
  })

  test('Phase F2: delete root WF 1-2 cascades to its 3 children', async () => {
    skipIfFailed()
    try {
      const wfName = workflowName(1, 2)
      const rootId = state.specIds.get(wfName)!

      const specRow = sharedPage
        .locator('[data-testid="spec-tree-row"]')
        .filter({ has: sharedPage.getByText(wfName, { exact: true }) })
      await specRow.hover()
      await specRow.getByRole('button', { name: 'Item actions' }).click()
      await sharedPage.getByRole('menuitem', { name: 'Delete' }).click()

      const dialog = sharedPage.getByRole('alertdialog')
      await expect(dialog).toBeVisible()
      // Wait for the batch-save DELETE request before checking the DB
      const deleteResponse = sharedPage.waitForResponse(
        (r) => r.url().includes('/api/v2/specifications/batch-save') && r.request().method() === 'POST' && r.ok(),
        { timeout: 10_000 },
      )
      await sharedPage.getByRole('button', { name: 'Delete' }).click()
      await expect(dialog).not.toBeVisible()
      await deleteResponse

      const db = openDb()
      // All 4 specs in chain should be gone (root + 3 children cascade via parentSpecificationId ON DELETE CASCADE)
      const remaining = (
        await db.query(`SELECT COUNT(*) as n FROM specification WHERE "rootSpecificationId" = $1`, [rootId])
      ).rows[0] as { n: number }
      expect(Number(remaining.n), 'all specs in chain deleted').toBe(0)

      // WF 1-1 (root survives — only its children were deleted in F1) and WF 1-3 still exist.
      const wf11Id = state.specIds.get(workflowName(1, 1))!
      const wf13Id = state.specIds.get(workflowName(1, 3))!
      expect(
        (await db.query(`SELECT id FROM specification WHERE id = $1`, [wf11Id])).rows[0],
        'sibling WF 1-1 intact',
      ).toBeDefined()
      expect(
        (await db.query(`SELECT id FROM specification WHERE id = $1`, [wf13Id])).rows[0],
        'sibling WF 1-3 intact',
      ).toBeDefined()

      state.specIds.delete(wfName)
      state.specIds.delete(`${wfName} / ${childName(1)}`)
      state.specIds.delete(`${wfName} / ${childName(2)}`)
      state.specIds.delete(`${wfName} / ${childName(3)}`)
    } catch (err) {
      state.failed = true
      throw err
    }
  })

  test('Phase F3: delete library 3 cascades all its specs', async () => {
    skipIfFailed()
    try {
      const libName = LIBRARY_NAMES[2]
      const libId = state.libraryIds.get(libName)!

      const libRow = sharedPage.getByRole('tree').getByRole('treeitem').filter({ hasText: libName }).first()
      await libRow.hover()
      await libRow.getByRole('button', { name: 'Library actions' }).click()
      await sharedPage.getByRole('menuitem', { name: 'Delete' }).click()

      const dialog = sharedPage.getByRole('alertdialog')
      await expect(dialog).toBeVisible()
      await sharedPage.getByRole('button', { name: 'Delete' }).click()
      await expect(dialog).not.toBeVisible()
      await expect(
        sharedPage.getByRole('tabpanel', { name: 'step libraries' }).getByText(libName, { exact: true }),
      ).not.toBeVisible({ timeout: 8_000 })

      const db = openDb()
      const libRowDb = (await db.query(`SELECT id FROM library WHERE id = $1`, [libId])).rows[0]
      expect(libRowDb, 'library 3 gone').toBeUndefined()

      const specsLeft = (await db.query(`SELECT COUNT(*) as n FROM specification WHERE "libraryId" = $1`, [libId]))
        .rows[0] as {
        n: number
      }
      expect(Number(specsLeft.n), 'all specs under library 3 cascade-deleted').toBe(0)

      state.libraryIds.delete(libName)
    } catch (err) {
      state.failed = true
      throw err
    }
  })

  test('Phase G: final DB state matches expected counts', async () => {
    skipIfFailed()
    try {
      const db = openDb()

      // Scope DB assertions to the libraries THIS spec created (tracked in
      // state.libraryIds) rather than the whole team: sibling specs share the
      // E2E Team, so a team-wide count also collects their rows (the assertion
      // then holds only on a fresh single-spec DB). Deleted libs (F3) are gone
      // from the map; renames (E1) keep the same id. Deleted ids match no rows.
      const libIds = [...state.libraryIds.values()]

      // Libraries remaining for this spec
      const libRows = (
        await db.query(`SELECT name, "parentLibraryId" FROM library WHERE id = ANY($1::text[])`, [libIds])
      ).rows as Array<{ name: string; parentLibraryId: string | null }>

      expect(libRows.length, 'expected 3 libraries remaining').toBe(3)
      const topLevel = libRows.filter((r) => r.parentLibraryId === null)
      const subLibs = libRows.filter((r) => r.parentLibraryId !== null)
      expect(topLevel.length, 'expected 2 top-level libs').toBe(2)
      expect(subLibs.length, 'expected 1 sub-library').toBe(1)

      // Spec count: 17 remaining. 36 created (9 roots × 4) − F1 (WF 1-1's 3 children
      // L1/L2/L3, root kept = 3) − F2 (WF 1-2 root + 3 = 4) − F3 (library 3: 3 roots × 4 = 12).
      const specCount = (
        await db.query(`SELECT COUNT(*) as n FROM specification WHERE "libraryId" = ANY($1::text[])`, [libIds])
      ).rows[0] as { n: number }
      expect(Number(specCount.n), 'expected 17 specs remaining').toBe(17)

      // No orphaned proxy_references (trivially 0 — proxy_reference is not written by app)
      const orphans = (
        await db.query(
          `SELECT COUNT(*) as n FROM proxy_reference pr
            WHERE NOT EXISTS (SELECT 1 FROM specification WHERE id = pr."parentSpecificationId")
               OR NOT EXISTS (SELECT 1 FROM specification WHERE id = pr."targetSpecificationId")`,
        )
      ).rows[0] as { n: number }
      expect(Number(orphans.n), 'no orphaned proxy_references').toBe(0)

      // Log the full tree for human verification
      const tree = (
        await db.query(
          `SELECT l.name as libraryName, s.name as specName, s.id, s."parentSpecificationId"
             FROM specification s
             JOIN library l ON l.id = s."libraryId"
            WHERE l."teamId" = $1
            ORDER BY l.name, s."createdAt"`,
          [state.teamId],
        )
      ).rows
      console.log('Final tree for team', state.teamId, JSON.stringify(tree, null, 2))
    } catch (err) {
      state.failed = true
      throw err
    }
  })
})
