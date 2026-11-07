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

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@mission/ui'
import { SearchableSelect, type ComboboxGroup } from '@mission/ui/combobox'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@mission/ui'
import { Button } from '@mission/ui'
import { Input } from '@mission/ui'
import { Label } from '@mission/ui'
import { Plus } from 'lucide-react'
import { useAvailableValueProperties } from '@/hooks/useAvailableValueProperties'
import { useAvailableParameters } from '@/hooks/useAvailableParameters'
import { useAvailableValueTypes } from '@/hooks/useAvailableValueTypes'
import { useFlowStore } from '@/stores/flowStore'
import { useLibraryStore } from '@/stores/libraryStore'
import { useSpecificationStore } from '@/stores/specificationStore'
import { generateOID, WORKER_INTERNAL } from '@/lib/snowflake'
import {
  buildDotNotation,
  createDefaultEntries,
  createEntriesFromValueType,
  sanitizeDotName,
  HIDDEN_ENTRY_NAMES,
} from '@/lib/value-utils'
import type { ValueSpec } from '@/types/nodes'

interface OutputParameterSelectProps {
  value: string | undefined
  onChange: (name: string) => void
  readOnly?: boolean
  /** When true, hides the "Add Value Property" and "Add Entry to Property" action items. */
  readOnlyActions?: boolean
  /**
   * When true, also offer each Value Property's bare name as a destination
   * (in addition to its dot-notation entries). Mirrors the SendSourceSelect
   * shape so a Sync Receive can target the whole property the symmetric
   * Sync Send wrote into. Default false: entry-only destinations.
   */
  includePropertyNames?: boolean
}

/**
 * Searchable picker for choosing an output target from available Value Property entries.
 * Shows Property.Entry dot notation items grouped by source workflow level, filtered as you type.
 * Includes dialogs to add new properties or entries inline.
 */
function OutputParameterSelectComponent({
  value,
  onChange,
  readOnly = false,
  readOnlyActions = false,
  includePropertyNames = false,
}: OutputParameterSelectProps) {
  const { groups, allNames, allEntryRefs, writableLevels } = useAvailableValueProperties()
  const { workflowInputParams, workflowOutputParams, parentOutputParams, parentInputParams } = useAvailableParameters()
  const { allValueTypes } = useAvailableValueTypes()

  // Collect all parameter names for unresolved detection
  const allParamNames = useMemo(() => {
    const names = new Set<string>()
    for (const p of workflowInputParams) names.add(p.name)
    for (const p of workflowOutputParams) names.add(p.name)
    for (const p of parentOutputParams) names.add(p.name)
    for (const p of parentInputParams) names.add(p.name)
    return names
  }, [workflowInputParams, workflowOutputParams, parentOutputParams, parentInputParams])

  const isUnresolved =
    !!value && !allEntryRefs.has(value) && !allParamNames.has(value) && !(includePropertyNames && allNames.has(value))

  const [showAddPropertyDialog, setShowAddPropertyDialog] = useState(false)
  const [showAddEntryDialog, setShowAddEntryDialog] = useState(false)
  const [newPropertyName, setNewPropertyName] = useState('')
  const [selectedTargetLevel, setSelectedTargetLevel] = useState<string>('__current__')
  const [newPropertyValueTypeId, setNewPropertyValueTypeId] = useState<string>('__freeform__')
  const [newEntryName, setNewEntryName] = useState('')
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>('')
  const nameInputRef = useRef<HTMLInputElement>(null)
  const entryNameInputRef = useRef<HTMLInputElement>(null)

  // Focus inputs when dialogs open
  useEffect(() => {
    if (showAddPropertyDialog) {
      const timer = setTimeout(() => nameInputRef.current?.focus(), 0)
      return () => clearTimeout(timer)
    }
  }, [showAddPropertyDialog])

  useEffect(() => {
    if (showAddEntryDialog) {
      const timer = setTimeout(() => entryNameInputRef.current?.focus(), 0)
      return () => clearTimeout(timer)
    }
  }, [showAddEntryDialog])

  // Build flat list of entry ref items grouped by workflow level. When
  // `includePropertyNames` is set, each property is preceded by its bare-name
  // option (mirroring SendSourceSelect) so callers like Sync Receive can
  // target the whole property a symmetric Sync Send is writing.
  const entryItems = useMemo(() => {
    const items: Array<{ groupLabel: string; refs: Array<{ ref: string; label: string }> }> = []
    for (const group of groups) {
      const refs: Array<{ ref: string; label: string }> = []
      for (const v of group.values) {
        if (!v.name) continue
        if (includePropertyNames) {
          refs.push({ ref: v.name, label: v.name })
        }
        for (const entry of v.entries) {
          if (!entry.name || HIDDEN_ENTRY_NAMES.has(entry.name)) continue
          const ref = buildDotNotation(v.name, entry.name)
          refs.push({ ref, label: includePropertyNames ? `  ${ref}` : ref })
        }
      }
      if (refs.length > 0) {
        items.push({ groupLabel: group.label, refs })
      }
    }
    return items
  }, [groups, includePropertyNames])

  // All properties across all groups for the "Add Entry" dialog
  const allProperties = useMemo(() => {
    const props: Array<{ id: string; name: string; levelLabel: string; specId: string | null }> = []
    for (const group of groups) {
      for (const v of group.values) {
        if (v.name) {
          props.push({ id: v.id, name: v.name, levelLabel: group.label, specId: group.specId })
        }
      }
    }
    return props
  }, [groups])

  const triggerText = useMemo(() => {
    if (!value) return undefined
    if (isUnresolved) return `${value} (unresolved)`
    return value
  }, [value, isUnresolved])

  const handleValueChange = useCallback(
    (v: string) => {
      if (v === '__add_property__') {
        setNewPropertyName('')
        setSelectedTargetLevel('__current__')
        setNewPropertyValueTypeId('__freeform__')
        setShowAddPropertyDialog(true)
        return
      }
      if (v === '__add_entry__') {
        setNewEntryName('')
        setSelectedPropertyId(allProperties[0]?.id || '')
        setShowAddEntryDialog(true)
        return
      }
      onChange(v === '__none__' ? '' : v)
    },
    [onChange, allProperties],
  )

  /** Add a new value property to the specified workflow level */
  const handleAddPropertyConfirm = useCallback(() => {
    const trimmed = sanitizeDotName(newPropertyName)
    if (!trimmed) return

    const selectedType = allValueTypes.find((vt) => vt.id === newPropertyValueTypeId)
    const newProp: ValueSpec = {
      id: generateOID(WORKER_INTERNAL),
      name: trimmed,
      entries: selectedType ? createEntriesFromValueType(selectedType) : createDefaultEntries(),
    }

    if (selectedTargetLevel === '__current__') {
      // Write to current workflow via flowStore
      const currentValues = useFlowStore.getState().workflowValues
      useFlowStore.getState().setWorkflowValues([...currentValues, newProp])
    } else {
      // Write to parent/ancestor workflow via library store
      const specId = selectedTargetLevel
      const spec = findSpecById(specId)
      if (spec) {
        const existingData = spec.data as Record<string, unknown>
        const existingValues = (existingData.workflowValues || []) as ValueSpec[]
        useSpecificationStore.getState().updateInMemory(specId, {
          data: { ...existingData, workflowValues: [...existingValues, newProp] },
        })
      }
    }

    // Auto-select the first non-Description entry ("Value" for Freeform)
    const firstEntry = newProp.entries.find((e) => e.name !== 'Description')?.name ?? 'Value'
    onChange(buildDotNotation(trimmed, firstEntry))
    setShowAddPropertyDialog(false)
  }, [newPropertyName, selectedTargetLevel, onChange, allValueTypes, newPropertyValueTypeId])

  /** Add a new entry to an existing property */
  const handleAddEntryConfirm = useCallback(() => {
    const trimmedEntry = sanitizeDotName(newEntryName)
    if (!trimmedEntry || !selectedPropertyId) return

    // Find which group contains this property
    let targetGroup: (typeof groups)[number] | null = null
    let targetProp: ValueSpec | null = null
    for (const group of groups) {
      const found = group.values.find((v) => v.id === selectedPropertyId)
      if (found) {
        targetGroup = group
        targetProp = found
        break
      }
    }
    if (!targetGroup || !targetProp) return

    const newEntry = { id: generateOID(WORKER_INTERNAL), name: trimmedEntry, value: '' }

    if (targetGroup.specId === null) {
      // Current workflow
      const currentValues = useFlowStore.getState().workflowValues
      const updated = currentValues.map((v) =>
        v.id === selectedPropertyId ? { ...v, entries: [...v.entries, newEntry] } : v,
      )
      useFlowStore.getState().setWorkflowValues(updated)
    } else {
      // Parent workflow via library store
      const spec = findSpecById(targetGroup.specId)
      if (spec) {
        const existingData = spec.data as Record<string, unknown>
        const existingValues = (existingData.workflowValues || []) as ValueSpec[]
        const updatedValues = existingValues.map((v) =>
          v.id === selectedPropertyId ? { ...v, entries: [...v.entries, newEntry] } : v,
        )
        useSpecificationStore.getState().updateInMemory(targetGroup.specId, {
          data: { ...existingData, workflowValues: updatedValues },
        })
      }
    }

    onChange(buildDotNotation(targetProp.name, trimmedEntry))
    setShowAddEntryDialog(false)
  }, [newEntryName, selectedPropertyId, groups, onChange])

  // Picker rows, in the old Select's order; the Add... actions stay visible while filtering.
  const pickerGroups = useMemo<ComboboxGroup[]>(() => {
    const paramGroup = (heading: string, params: Array<{ name: string }>): ComboboxGroup[] =>
      params.length > 0 ? [{ heading, items: params.map((p) => ({ value: p.name })) }] : []
    const result: ComboboxGroup[] = [{ items: [{ value: '__none__', label: '(none)', searchText: '(none)' }] }]
    for (const group of entryItems) {
      result.push({
        heading: group.groupLabel,
        items: group.refs.map((item) => ({
          value: item.ref,
          label: item.label.trim(),
          indent: item.label !== item.ref,
        })),
      })
    }
    result.push(
      ...paramGroup('Workflow Output Parameters', workflowOutputParams),
      ...paramGroup('Workflow Input Parameters', workflowInputParams),
      ...paramGroup('Parent Output Parameters', parentOutputParams),
      ...paramGroup('Parent Input Parameters', parentInputParams),
    )
    if (isUnresolved) {
      result.push({
        heading: <span className="text-amber-600">Unresolved</span>,
        items: [{ value: value!, label: `${value} (unresolved)`, className: 'text-amber-700' }],
      })
    }
    if (!readOnlyActions) {
      result.push({
        pinned: true,
        items: [
          {
            value: '__add_property__',
            label: (
              <span className="flex items-center gap-1 text-link">
                <Plus className="h-3 w-3" />
                Add Value Property...
              </span>
            ),
          },
          {
            value: '__add_entry__',
            label: (
              <span className="flex items-center gap-1 text-link">
                <Plus className="h-3 w-3" />
                Add Entry to Property...
              </span>
            ),
          },
        ],
      })
    }
    return result
  }, [
    entryItems,
    workflowOutputParams,
    workflowInputParams,
    parentOutputParams,
    parentInputParams,
    isUnresolved,
    value,
    readOnlyActions,
  ])

  return (
    <>
      <SearchableSelect
        groups={pickerGroups}
        value={value || '__none__'}
        onSelect={handleValueChange}
        triggerText={triggerText}
        placeholder="Select value destination..."
        searchPlaceholder="Type to filter destinations..."
        disabled={readOnly}
        className={`h-7 text-sm ${isUnresolved ? 'border-amber-400 text-amber-700' : ''}`}
      />

      {/* Add Value Property dialog */}
      <Dialog open={showAddPropertyDialog} onOpenChange={setShowAddPropertyDialog}>
        <DialogContent className="max-w-sm" onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle className="text-sm">Add Value Property</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Creates a new Value Property — Freeform (Value + Description entries) or copied from a Value Type.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            {writableLevels.length > 1 && (
              <div className="space-y-1">
                <Label className="text-xs">Target Workflow</Label>
                <Select value={selectedTargetLevel} onValueChange={setSelectedTargetLevel}>
                  <SelectTrigger className="h-7 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {writableLevels.map((level) => (
                      <SelectItem key={level.specId ?? '__current__'} value={level.specId ?? '__current__'}>
                        {level.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs">Property Name</Label>
              <Input
                ref={nameInputRef}
                value={newPropertyName}
                onChange={(e) => setNewPropertyName(e.target.value.replace(/[.\s]/g, ''))}
                placeholder="e.g. UserResponse"
                className="h-7 text-sm"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newPropertyName.trim()) handleAddPropertyConfirm()
                }}
              />
            </div>
            {allValueTypes.length > 0 && (
              <div className="space-y-1">
                <Label className="text-xs">Entries</Label>
                <Select value={newPropertyValueTypeId} onValueChange={setNewPropertyValueTypeId}>
                  <SelectTrigger className="h-7 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__freeform__">Freeform (Value + Description)</SelectItem>
                    {allValueTypes.map((vt) => (
                      <SelectItem key={vt.id} value={vt.id}>
                        From {vt.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => setShowAddPropertyDialog(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleAddPropertyConfirm} disabled={!newPropertyName.trim()}>
                Add
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Entry to Property dialog */}
      <Dialog open={showAddEntryDialog} onOpenChange={setShowAddEntryDialog}>
        <DialogContent className="max-w-sm" onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle className="text-sm">Add Entry to Property</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Adds a custom entry to an existing Value Property.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <div className="space-y-1">
              <Label className="text-xs">Property</Label>
              <Select value={selectedPropertyId} onValueChange={setSelectedPropertyId}>
                <SelectTrigger className="h-7 text-sm">
                  <SelectValue placeholder="Select property..." />
                </SelectTrigger>
                <SelectContent>
                  {allProperties.map((prop) => (
                    <SelectItem key={prop.id} value={prop.id}>
                      {prop.name} ({prop.levelLabel})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Entry Name</Label>
              <Input
                ref={entryNameInputRef}
                value={newEntryName}
                onChange={(e) => setNewEntryName(e.target.value.replace(/[.\s]/g, ''))}
                placeholder="e.g. Units"
                className="h-7 text-sm"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newEntryName.trim() && selectedPropertyId) handleAddEntryConfirm()
                }}
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => setShowAddEntryDialog(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleAddEntryConfirm} disabled={!newEntryName.trim() || !selectedPropertyId}>
                Add
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** Helper to find a specification by ID across all libraries */
function findSpecById(specId: string) {
  const specifications = useLibraryStore.getState().specifications
  for (const specs of specifications.values()) {
    const found = specs.find((s) => s.id === specId)
    if (found) return found
  }
  return null
}

export const OutputParameterSelect = memo(OutputParameterSelectComponent)
