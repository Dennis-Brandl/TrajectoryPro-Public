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
import { Input } from '@mission/ui'
import { ChevronDown } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@mission/ui'
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

interface RefGroup {
  label: string
  refs: Array<{ ref: string; display: string }>
}

/** Property and Property.Entry rows for a list of ValueSpec groups (hidden entries skipped). */
function toRefGroups(groups: Array<{ label: string; values: ValueSpec[] }>): RefGroup[] {
  const result: RefGroup[] = []
  for (const group of groups) {
    const refs: Array<{ ref: string; display: string }> = []
    for (const v of group.values) {
      if (!v.name) continue
      refs.push({ ref: v.name, display: v.name })
      for (const entry of v.entries ?? []) {
        if (!entry.name || HIDDEN_ENTRY_NAMES.has(entry.name)) continue
        const ref = buildDotNotation(v.name, entry.name)
        refs.push({ ref, display: `  ${ref}` })
      }
    }
    if (refs.length > 0) result.push({ label: group.label, refs })
  }
  return result
}

/**
 * A text input with an adjacent dropdown picker for selecting Value Property entries.
 * Shows Property.Entry dot notation items grouped by workflow level.
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

  // Build flat list of entry ref items grouped by workflow level
  const entryGroups = useMemo(() => toRefGroups(groups), [groups])
  const actionEntryGroups = useMemo(
    () => (includeActionProperties ? toRefGroups(actionGroups) : []),
    [actionGroups, includeActionProperties],
  )

  const hasProperties =
    entryGroups.length > 0 || actionEntryGroups.length > 0 || (extraGroups && extraGroups.length > 0)

  return (
    <div className={`flex ${className}`}>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-7 text-sm flex-1 rounded-r-none border-r-0"
        readOnly={readOnly}
      />
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={readOnly || !hasProperties}
          className="h-7 px-1 border border-input rounded-r-md bg-transparent hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
        >
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-96 overflow-y-auto">
          {extraGroups?.map((group, gi) => (
            <DropdownMenuGroup key={`extra-${gi}`}>
              {gi > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel className="text-xs text-muted-foreground">{group.label}</DropdownMenuLabel>
              {group.items.map((item) => (
                <DropdownMenuItem key={item.value} onSelect={() => onChange(item.value)} className="text-sm">
                  {item.display}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          ))}
          {entryGroups.map((group, gi) => (
            <DropdownMenuGroup key={gi}>
              {(gi > 0 || (extraGroups && extraGroups.length > 0)) && <DropdownMenuSeparator />}
              <DropdownMenuLabel className="text-xs text-muted-foreground">{group.label}</DropdownMenuLabel>
              {group.refs.map((item) => (
                <DropdownMenuItem key={item.ref} onSelect={() => onChange(item.ref)} className="text-sm">
                  {item.display}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          ))}
          {actionEntryGroups.map((group, gi) => (
            <DropdownMenuGroup key={`action-${gi}`}>
              {(gi > 0 || entryGroups.length > 0 || (extraGroups && extraGroups.length > 0)) && (
                <DropdownMenuSeparator />
              )}
              <DropdownMenuLabel className="text-xs text-muted-foreground">{group.label}</DropdownMenuLabel>
              {group.refs.map((item) => (
                <DropdownMenuItem key={item.ref} onSelect={() => onChange(item.ref)} className="text-sm">
                  {item.display}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export const ValuePropertyInput = memo(ValuePropertyInputComponent)
