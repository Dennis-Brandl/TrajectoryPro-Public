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

import { memo, useMemo } from 'react'
import { AutocompleteInput, type ComboboxGroup } from '@mission/ui/combobox'
import { useAvailableValueProperties } from '@/hooks/useAvailableValueProperties'
import { useAvailableActionProperties } from '@/hooks/useAvailableActionProperties'
import { buildDotNotation, HIDDEN_ENTRY_NAMES } from '@/lib/value-utils'
import type { ValueSpec } from '@/types/nodes'

export interface ExtraPickerGroup {
  label: string
  items: Array<{ value: string; display: string }>
}

interface ValuePropertyInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  readOnly?: boolean
  className?: string
  /** Additional groups to show in the dropdown (e.g. workflow input parameters) */
  extraGroups?: ExtraPickerGroup[]
  /** Spec 2026-09-04 §5.2.2: also offer environment Action Properties (after the Value Properties). */
  includeActionProperties?: boolean
}

/** Property and indented Property.Entry rows for a list of ValueSpec groups (hidden entries skipped). */
function toComboboxGroups(groups: Array<{ label: string; values: ValueSpec[] }>): ComboboxGroup[] {
  const result: ComboboxGroup[] = []
  for (const group of groups) {
    const items: ComboboxGroup['items'] = []
    for (const v of group.values) {
      if (!v.name) continue
      items.push({ value: v.name })
      for (const entry of v.entries ?? []) {
        if (!entry.name || HIDDEN_ENTRY_NAMES.has(entry.name)) continue
        items.push({ value: buildDotNotation(v.name, entry.name), indent: true })
      }
    }
    if (items.length > 0) result.push({ heading: group.label, items })
  }
  return result
}

/**
 * A text input whose suggestion list (workflow parameters, Value Property entries,
 * Action Properties) filters on what is typed; the ▾ button shows the whole list.
 * The field stays free text: a reference that is not listed can still be typed.
 */
function ValuePropertyInputComponent({
  value,
  onChange,
  placeholder = 'Value',
  readOnly = false,
  className = '',
  extraGroups,
  includeActionProperties = false,
}: ValuePropertyInputProps) {
  const { groups } = useAvailableValueProperties()
  const { groups: actionGroups } = useAvailableActionProperties()

  const pickerGroups = useMemo<ComboboxGroup[]>(
    () => [
      ...(extraGroups ?? [])
        .filter((g) => g.items.length > 0)
        .map((g) => ({
          heading: g.label,
          items: g.items.map((i) => ({ value: i.value, label: i.display, searchText: i.display })),
        })),
      ...toComboboxGroups(groups),
      ...(includeActionProperties ? toComboboxGroups(actionGroups) : []),
    ],
    [extraGroups, groups, actionGroups, includeActionProperties],
  )

  return (
    <AutocompleteInput
      groups={pickerGroups}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      readOnly={readOnly}
      className={className}
      inputClassName="h-7"
      toggleLabel="Show sources"
    />
  )
}

export const ValuePropertyInput = memo(ValuePropertyInputComponent)
