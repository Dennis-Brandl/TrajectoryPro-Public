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
import type { Block, FormDocument, ParameterDefaultSource } from '@mission/form-schema'

// The renderer keeps its settled-timer set in private state and only discards it on
// remount (HOST-CONTRACT §3). Because TaskScreen remounts the renderer per step
// INSTANCE (`key={task.stepInstanceId}`), the gate computed for a freshly-entered
// task is always correct with an empty settled-timer set.
export const EMPTY_TIMERS: ReadonlySet<string> = new Set()

function literalDefault(source: ParameterDefaultSource | undefined): string | undefined {
  if (!source) return undefined
  if (source.mode === 'static') return source.value
  // defaultSource needs the instance property store, which the inbox payload does not carry — V1 renders it empty (spec §7.3 boundary).
  return undefined
}

function fieldNameOf(block: Block): string | undefined {
  if ('fieldName' in block) return block.fieldName
  return undefined
}

function defaultSourceOf(block: Block): ParameterDefaultSource | undefined {
  if ('defaultSource' in block) return block.defaultSource
  return undefined
}

/**
 * Seed `values` from each block's literal (`mode: 'static'`) default before mount —
 * the renderer never resolves defaults itself (HOST-CONTRACT §1). Blocks with no
 * `fieldName`/`defaultSource`, or whose default is a property/input reference,
 * contribute nothing.
 */
export function seedDefaults(doc: FormDocument): Record<string, string> {
  const seeded: Record<string, string> = {}
  for (const section of doc.sections) {
    for (const row of section.rows) {
      for (const block of row.blocks) {
        const fieldName = fieldNameOf(block)
        if (!fieldName) continue
        const value = literalDefault(defaultSourceOf(block))
        if (value !== undefined) seeded[fieldName] = value
      }
    }
  }
  return seeded
}
