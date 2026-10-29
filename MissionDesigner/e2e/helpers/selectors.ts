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

import type { Page, Locator } from '@playwright/test'

export function stepsTab(page: Page): Locator {
  return page.getByRole('tab', { name: 'Steps' })
}

export function newLibraryBtn(page: Page): Locator {
  return page.getByRole('button', { name: 'New Library' })
}

/** Treeitem for a library by name — resolves unambiguously in the sidebar tree. */
export function libraryRow(page: Page, name: string): Locator {
  return page.getByRole('tree').getByRole('treeitem').filter({ hasText: name }).first()
}

/** The "..." MoreHorizontal context-menu button on a library row (reveals on hover). */
export function libraryMenuBtn(page: Page, name: string): Locator {
  // After treeitem scoping, the menu button is the last button in the row.
  return libraryRow(page, name).locator('button').last()
}

/** Treeitem for a specification by name — resolves unambiguously in the sidebar tree. */
export function specRow(page: Page, name: string): Locator {
  return page.getByRole('tree').getByRole('treeitem').filter({ hasText: name }).first()
}

/** Trash icon button on the spec row (reveals on hover). */
export function specDeleteBtn(page: Page, name: string): Locator {
  return specRow(page, name).locator('button')
}

/** Tree panel wrapper — scope other queries inside this to exclude detail-panel matches. */
export function libraryTreePanel(page: Page, entityType: 'step' | 'workflow' = 'step'): Locator {
  return page.getByRole('tabpanel', { name: `${entityType} libraries` })
}

export function alertDialog(page: Page): Locator {
  return page.getByRole('alertdialog')
}

export function dialogTextbox(page: Page): Locator {
  return alertDialog(page).getByRole('textbox')
}

export function createBtn(page: Page): Locator {
  return page.getByRole('button', { name: 'Create' })
}

export function renameBtn(page: Page): Locator {
  return page.getByRole('button', { name: 'Rename' })
}

export function deleteBtn(page: Page): Locator {
  return page.getByRole('button', { name: 'Delete' })
}

export function menuItem(page: Page, name: string | RegExp): Locator {
  return page.getByRole('menuitem', { name })
}

export function libraryDescriptionField(page: Page): Locator {
  return page.getByLabel('Library Description')
}

export function authorField(page: Page): Locator {
  return page.getByLabel('Author')
}

export function saveBtn(page: Page): Locator {
  return page.getByRole('button', { name: /^Save$/ })
}

export function addInputBtn(page: Page): Locator {
  return page.getByRole('button', { name: 'Add input parameter' })
}

export function addOutputBtn(page: Page): Locator {
  return page.getByRole('button', { name: 'Add output parameter' })
}

export function addValueBtn(page: Page): Locator {
  return page.getByRole('button', { name: 'Add value property' })
}

export function addResourceBtn(page: Page): Locator {
  return page.getByRole('button', { name: 'Add resource' })
}

/** Palette item in the step palette (left edge of canvas). Matches by label text. */
export function paletteItem(page: Page, label: string): Locator {
  return page.getByText(label, { exact: true })
}

/** Sub-workflow creation dialog name input (only visible when "Create New Empty Workflow" mode selected). */
export function subWorkflowDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Add Sub-Workflow' })
}
