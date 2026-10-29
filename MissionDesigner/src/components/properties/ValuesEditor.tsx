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

import { memo, useCallback } from 'react'
import { Button } from '@mission/ui'
import { Input } from '@mission/ui'
import { Label } from '@mission/ui'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@mission/ui'
import { Plus, Trash2 } from 'lucide-react'
import type { ValueSpec, ValueEntrySpec, ValueTypeSpec } from '@/types/nodes'
import { generateOID, WORKER_INTERNAL } from '@/lib/snowflake'
import {
  createDefaultEntries,
  createEntriesFromValueType,
  sanitizeDotName,
  PROTECTED_ENTRY_NAMES,
} from '@/lib/value-utils'

interface ValuesEditorProps {
  values: ValueSpec[]
  onChange: (values: ValueSpec[]) => void
  /** When true, displays values as read-only (no add/edit/delete) */
  readOnly?: boolean
  /** Override the section header label (default: "Value Properties") */
  label?: string
  /** Override the name input placeholder (default: "Property Name") */
  namePlaceholder?: string
  /** Override the empty-state message (default: "No values defined") */
  emptyMessage?: string
  /** When true, hides the internal section title (accordion supplies it) */
  hideHeading?: boolean
  /** In-scope Value Types offered as entry templates when adding a property (empty → plain add button only) */
  availableValueTypes?: ValueTypeSpec[]
}

function ValuesEditorComponent({
  values,
  onChange,
  readOnly = false,
  label = 'Value Properties',
  namePlaceholder = 'Property Name',
  emptyMessage = 'No values defined',
  hideHeading = false,
  availableValueTypes,
}: ValuesEditorProps) {
  const addProperty = useCallback(() => {
    onChange([
      ...values,
      {
        id: generateOID(WORKER_INTERNAL),
        name: '',
        entries: createDefaultEntries(),
      },
    ])
  }, [values, onChange])

  const addPropertyFromType = useCallback(
    (vt: ValueTypeSpec) => {
      onChange([
        ...values,
        {
          id: generateOID(WORKER_INTERNAL),
          name: '',
          entries: createEntriesFromValueType(vt),
        },
      ])
    },
    [values, onChange],
  )

  const removeProperty = useCallback(
    (id: string) => {
      onChange(values.filter((v) => v.id !== id))
    },
    [values, onChange],
  )

  const updatePropertyName = useCallback(
    (id: string, name: string) => {
      onChange(values.map((v) => (v.id === id ? { ...v, name: sanitizeDotName(name) } : v)))
    },
    [values, onChange],
  )

  const updateEntry = useCallback(
    (propertyId: string, entryId: string, updates: Partial<ValueEntrySpec>) => {
      onChange(
        values.map((v) =>
          v.id === propertyId
            ? {
                ...v,
                entries: v.entries.map((e) => (e.id === entryId ? { ...e, ...updates } : e)),
              }
            : v,
        ),
      )
    },
    [values, onChange],
  )

  const addEntry = useCallback(
    (propertyId: string) => {
      onChange(
        values.map((v) =>
          v.id === propertyId
            ? {
                ...v,
                entries: [...v.entries, { id: generateOID(WORKER_INTERNAL), name: '', value: '' }],
              }
            : v,
        ),
      )
    },
    [values, onChange],
  )

  const removeEntry = useCallback(
    (propertyId: string, entryId: string) => {
      onChange(
        values.map((v) => (v.id === propertyId ? { ...v, entries: v.entries.filter((e) => e.id !== entryId) } : v)),
      )
    },
    [values, onChange],
  )

  const usableValueTypes = (availableValueTypes ?? []).filter(
    (vt) => !!vt.name && vt.entries.some((e) => e.name.trim() !== ''),
  )

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        {!hideHeading && <Label className="text-xs font-medium">{label}</Label>}
        {!readOnly &&
          (usableValueTypes.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" aria-label="Add value property">
                  <Plus className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => addProperty()}>Freeform</DropdownMenuItem>
                {usableValueTypes.map((vt) => (
                  <DropdownMenuItem key={vt.id} onSelect={() => addPropertyFromType(vt)}>
                    From {vt.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={addProperty}
              aria-label="Add value property"
            >
              <Plus className="h-3 w-3" />
            </Button>
          ))}
      </div>

      {values.length === 0 && <p className="text-xs text-slate-500 dark:text-slate-400 italic">{emptyMessage}</p>}

      {values.map((v) => (
        <div key={v.id} className="border border-slate-200 dark:border-slate-700 rounded-md p-2 space-y-1.5">
          {/* Property name row */}
          <div className="flex gap-1 items-center">
            <Input
              placeholder={namePlaceholder}
              value={v.name}
              onChange={(e) => updatePropertyName(v.id, e.target.value)}
              className="h-7 text-sm font-medium w-56"
              disabled={readOnly}
            />
            {!readOnly && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeProperty(v.id)}
                className="h-6 w-6 p-0 text-red-500 hover:text-red-700"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </div>

          {/* Entry rows */}
          {v.entries.map((entry) => {
            const isProtected = PROTECTED_ENTRY_NAMES.has(entry.name)
            return (
              <div key={entry.id} className="flex gap-1 items-center pl-2">
                {isProtected || readOnly ? (
                  <span
                    className="text-xs text-slate-500 dark:text-slate-400 w-20 shrink-0 truncate"
                    title={entry.name}
                  >
                    {entry.name || '(unnamed)'}
                  </span>
                ) : (
                  <Input
                    placeholder="Entry Name"
                    value={entry.name}
                    onChange={(e) => updateEntry(v.id, entry.id, { name: sanitizeDotName(e.target.value) })}
                    className="h-6 text-xs w-40 shrink-0"
                  />
                )}
                <Input
                  placeholder="Value"
                  value={entry.value}
                  onChange={(e) => updateEntry(v.id, entry.id, { value: e.target.value })}
                  className="h-6 text-xs flex-1"
                  disabled={readOnly}
                />
                {!readOnly && !isProtected && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeEntry(v.id, entry.id)}
                    className="h-5 w-5 p-0 text-red-400 hover:text-red-600"
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                  </Button>
                )}
                {!readOnly && isProtected && <div className="w-5" /> /* spacer to keep alignment */}
              </div>
            )
          })}

          {/* Add entry button */}
          {!readOnly && (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 text-xs text-blue-600 hover:text-blue-800 pl-2"
              onClick={() => addEntry(v.id)}
            >
              <Plus className="h-2.5 w-2.5 mr-0.5" />
              Add Entry
            </Button>
          )}
        </div>
      ))}
    </div>
  )
}

export const ValuesEditor = memo(ValuesEditorComponent)
