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

import { PropertyEditError, type PropertyMutation } from './types.js'

/** Shape of one property specification element as the engine touches it. */
export interface PropertySpecRecord {
  name: string
  entries: Array<{ name: string; value: string }>
}

/**
 * Apply a batch of console edits to a property specification list IN PLACE,
 * strictly: every edit must name an existing property AND an existing entry,
 * and only `value` is touched — every other field on the spec or entry is
 * preserved. Throws PropertyEditError on the first unknown name.
 *
 * Callers pass a fresh copy of the specs (a JSON.parse result), so a throw
 * part-way through leaves storage untouched and the batch is all-or-nothing.
 *
 * Shared by InstanceManager.setPropertyValues() (environment-level set) and
 * the server's per-action route (an action's own set).
 *
 * @returns changed entry names per touched spec, in first-seen order
 */
export function applyPropertyEdits(
  specs: PropertySpecRecord[],
  edits: PropertyMutation[],
  scope: string
): Map<string, string[]> {
  const changedBySpec = new Map<string, string[]>()
  for (const edit of edits) {
    const spec = specs.find((s) => s.name === edit.spec_name)
    if (!spec) {
      throw new PropertyEditError(
        'PROPERTY_NOT_FOUND',
        `Property '${edit.spec_name}' not found in ${scope}`,
        { property: edit.spec_name }
      )
    }
    const entry = spec.entries.find((e) => e.name === edit.entry_name)
    if (!entry) {
      throw new PropertyEditError(
        'ENTRY_NOT_FOUND',
        `Entry '${edit.entry_name}' not found in property '${edit.spec_name}'`,
        { property: edit.spec_name, entry: edit.entry_name }
      )
    }
    entry.value = edit.value
    const changed = changedBySpec.get(spec.name) ?? []
    if (!changed.includes(entry.name)) changed.push(entry.name)
    changedBySpec.set(spec.name, changed)
  }
  return changedBySpec
}
