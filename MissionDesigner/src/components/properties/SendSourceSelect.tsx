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

import { memo, useCallback, useMemo, useState } from 'react'
import { SearchableSelect, type ComboboxGroup } from '@mission/ui/combobox'
import { Input } from '@mission/ui'
import { useAvailableValueProperties } from '@/hooks/useAvailableValueProperties'
import { buildDotNotation, HIDDEN_ENTRY_NAMES } from '@/lib/value-utils'

interface SendSourceSelectProps {
  value: string | undefined
  onChange: (value: string | undefined) => void
  readOnly?: boolean
}

/**
 * Searchable picker (filters as you type) for choosing the source of a Sync Send command.
 * Options: (none), value property names, value property entries (dot notation),
 * or a literal value entered via text input.
 */
function SendSourceSelectComponent({ value, onChange, readOnly = false }: SendSourceSelectProps) {
  const { groups, allNames, allEntryRefs } = useAvailableValueProperties()

  // Determine if current value is a known property/entry ref or a literal
  const isKnownRef = !!value && (allNames.has(value) || allEntryRefs.has(value))
  const [literalMode, setLiteralMode] = useState(!!value && !isKnownRef)

  // Build grouped items: property names + entry refs
  const items = useMemo(() => {
    const result: Array<{
      groupLabel: string
      entries: Array<{ ref: string; label: string }>
    }> = []

    for (const group of groups) {
      const entries: Array<{ ref: string; label: string }> = []
      for (const v of group.values) {
        if (!v.name) continue
        // Add the property name itself
        entries.push({ ref: v.name, label: v.name })
        // Add each visible entry in dot notation
        for (const entry of v.entries) {
          if (!entry.name || HIDDEN_ENTRY_NAMES.has(entry.name)) continue
          const ref = buildDotNotation(v.name, entry.name)
          entries.push({ ref, label: `  ${ref}` })
        }
      }
      if (entries.length > 0) {
        result.push({ groupLabel: group.label, entries })
      }
    }
    return result
  }, [groups])

  const handleSelectChange = useCallback(
    (v: string) => {
      if (v === '__none__') {
        setLiteralMode(false)
        onChange(undefined)
      } else if (v === '__literal__') {
        setLiteralMode(true)
        onChange(undefined)
      } else {
        setLiteralMode(false)
        onChange(v)
      }
    },
    [onChange],
  )

  // In literal mode, show a text input instead of the dropdown value
  const selectValue = literalMode ? '__literal__' : value || ''

  const triggerText = useMemo(() => {
    if (literalMode) return 'Literal value'
    if (!value) return undefined
    if (isKnownRef) return value
    return `${value} (unresolved)`
  }, [literalMode, value, isKnownRef])

  const isUnresolved = !!value && !isKnownRef && !literalMode

  // Picker rows, in the old Select's order; "Literal value..." stays visible while filtering.
  const pickerGroups = useMemo<ComboboxGroup[]>(() => {
    const result: ComboboxGroup[] = [{ items: [{ value: '__none__', label: '(none)', searchText: '(none)' }] }]
    for (const group of items) {
      result.push({
        heading: group.groupLabel,
        items: group.entries.map((item) => ({
          value: item.ref,
          label: item.label.trim(),
          indent: item.label !== item.ref,
        })),
      })
    }
    if (isUnresolved) {
      result.push({
        heading: <span className="text-amber-600">Unresolved</span>,
        items: [{ value: value!, label: `${value} (unresolved)`, className: 'text-amber-700' }],
      })
    }
    result.push({
      pinned: true,
      items: [{ value: '__literal__', label: <span className="text-link">Literal value...</span> }],
    })
    return result
  }, [items, isUnresolved, value])

  return (
    <div className="space-y-1">
      <SearchableSelect
        groups={pickerGroups}
        value={selectValue || '__none__'}
        onSelect={handleSelectChange}
        triggerText={triggerText}
        placeholder="Select source..."
        searchPlaceholder="Type to filter sources..."
        disabled={readOnly}
        className={`h-7 text-xs ${isUnresolved ? 'border-amber-400 text-amber-700' : ''}`}
      />

      {literalMode && (
        <Input
          value={value || ''}
          onChange={(e) => onChange(e.target.value || undefined)}
          className="h-7 text-xs"
          placeholder="Type literal value..."
          disabled={readOnly}
          autoFocus
        />
      )}
    </div>
  )
}

export const SendSourceSelect = memo(SendSourceSelectComponent)
