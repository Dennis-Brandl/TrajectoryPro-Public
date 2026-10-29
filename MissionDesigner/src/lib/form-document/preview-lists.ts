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

import type { FormDocument } from '@mission/form-schema'
import type { ParameterSpec, ValueSpec } from '@/types/nodes'

type Item = { label: string; value: string }

/**
 * The preview's copy of a form with every list bound to an input parameter (listSource
 * `input`) filled from that parameter's value property — the elements Pilot will list at run
 * time (mission-control-db inbox `substituteFormDocumentParams`; the engine leaves out the
 * Description entry). Only workflow value properties are known at design time; anything else
 * leaves the list as authored. Never mutates `document`.
 */
export function fillPreviewLists(
  document: FormDocument,
  inputs: readonly ParameterSpec[] | undefined,
  workflowValues: readonly ValueSpec[] | undefined,
): FormDocument {
  const listFor = (paramName: string): Item[] | null => {
    const input = inputs?.find((i) => i.name === paramName)
    if (!input || input.valueType !== 'property' || !input.value) return null
    const prop = workflowValues?.find((v) => v.name === input.value)
    if (!prop) return null
    return prop.entries.filter((e) => e.name !== 'Description').map((e) => ({ label: e.value, value: e.value }))
  }

  let changed = false
  const sections = document.sections.map((section) => ({
    ...section,
    rows: section.rows.map((row) => ({
      ...row,
      blocks: row.blocks.map((block) => {
        const source = (block as { listSource?: { mode: string; value?: string } }).listSource
        if (source?.mode !== 'input' || !source.value) return block
        const items = listFor(source.value)
        if (!items) return block
        if (block.type === 'textInput') {
          changed = true
          return { ...block, listItems: items }
        }
        if (block.type === 'checkbox' || block.type === 'radio') {
          changed = true
          return { ...block, options: items }
        }
        return block
      }),
    })),
  }))
  return changed ? { ...document, sections } : document
}
