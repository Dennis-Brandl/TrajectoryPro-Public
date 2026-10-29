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

import type { ValueEntrySpec, ValueTypeSpec } from '@/types/nodes'
import { generateOID, WORKER_INTERNAL } from '@/lib/snowflake'

/** Entry names that cannot be deleted from a value property. */
export const PROTECTED_ENTRY_NAMES = new Set(['Description'])

/** Entry names hidden from input/output parameter source pickers (internal use only). */
export const HIDDEN_ENTRY_NAMES = new Set(['Description'])

/**
 * Creates the default entries for a new value property.
 */
export function createDefaultEntries(): ValueEntrySpec[] {
  return [
    { id: generateOID(WORKER_INTERNAL), name: 'Value', value: '' },
    { id: generateOID(WORKER_INTERNAL), name: 'Description', value: '' },
  ]
}

/**
 * Strips dots and leading/trailing whitespace from a name
 * to ensure it's safe for use in dot notation references.
 */
export function sanitizeDotName(name: string): string {
  return name.replace(/[.\s]/g, '')
}

/**
 * Builds a dot-notation reference from property and entry names.
 */
export function buildDotNotation(property: string, entry: string): string {
  return `${property}.${entry}`
}

/**
 * True for entry names a Value Type may not define: every property
 * automatically carries the protected Description entry, so a template
 * Description would collide with it on copy.
 */
export function isReservedValueTypeEntryName(name: string): boolean {
  return name.trim().toLowerCase() === 'description'
}

/**
 * Build a new property's entries from a Value Type template: one entry per
 * template entry (carrying its default value) plus the protected Description
 * entry, mirroring createDefaultEntries(). Reserved-named and blank-named
 * template entries are skipped defensively — the editor discourages creating
 * them, but imported or transient data might carry one.
 */
export function createEntriesFromValueType(template: ValueTypeSpec): ValueEntrySpec[] {
  return [
    ...template.entries
      .filter((e) => !isReservedValueTypeEntryName(e.name) && e.name.trim() !== '')
      .map((e) => ({
        id: generateOID(WORKER_INTERNAL),
        name: e.name,
        value: e.defaultValue ?? '',
      })),
    { id: generateOID(WORKER_INTERNAL), name: 'Description', value: '' },
  ]
}
