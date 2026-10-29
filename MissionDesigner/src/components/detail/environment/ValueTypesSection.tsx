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

import { useState } from 'react'
import { arrayMove } from '@dnd-kit/sortable'
import { Trash2, Plus, Shapes, ArrowUp, ArrowDown } from 'lucide-react'
import { toast } from 'sonner'
import { Input } from '@mission/ui'
import { Label } from '@mission/ui'
import { Textarea } from '@mission/ui'
import { Button } from '@mission/ui'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@mission/ui'
import { generateOID, WORKER_INTERNAL } from '@/lib/snowflake'
import { sanitizeDotName, isReservedValueTypeEntryName } from '@/lib/value-utils'
import type { ValueTypeSpec, ValueTypeEntrySpec } from '@/types/nodes'

export interface ValueTypesSectionProps {
  valueTypes: ValueTypeSpec[]
  onAdd: (vt: ValueTypeSpec) => void
  onRemove: (id: string) => void
  onUpdate: (id: string, updates: Partial<ValueTypeSpec>) => void
  hideHeader?: boolean
}

/**
 * Manages the "Value Types" section of the Environment detail form.
 * Value Types are Designer-only entry templates: creating a Value Property
 * "from" a type copies its entries; no link is kept and nothing reaches
 * runtime packages. Editing or deleting a type never touches existing
 * properties.
 */
export function ValueTypesSection({
  valueTypes,
  onAdd,
  onRemove,
  onUpdate,
  hideHeader = false,
}: ValueTypesSectionProps) {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [newTypeName, setNewTypeName] = useState('')
  const [newTypeDescription, setNewTypeDescription] = useState('')

  const resetDialog = () => {
    setNewTypeName('')
    setNewTypeDescription('')
  }

  const handleAddType = () => {
    const trimmed = sanitizeDotName(newTypeName.trim())
    if (!trimmed) return
    if (valueTypes.some((vt) => vt.name.toLowerCase() === trimmed.toLowerCase())) {
      toast.error(`A Value Type named "${trimmed}" already exists in this environment`)
      return
    }
    onAdd({
      id: generateOID(WORKER_INTERNAL),
      name: trimmed,
      description: newTypeDescription.trim() || undefined,
      entries: [],
    })
    resetDialog()
    setIsAddDialogOpen(false)
  }

  const renameType = (vt: ValueTypeSpec, newName: string) => {
    const trimmed = sanitizeDotName(newName)
    if (
      trimmed &&
      valueTypes.some((other) => other.id !== vt.id && other.name.toLowerCase() === trimmed.toLowerCase())
    ) {
      toast.error(`A Value Type named "${trimmed}" already exists in this environment`)
      return
    }
    onUpdate(vt.id, { name: trimmed })
  }

  const updateEntry = (vt: ValueTypeSpec, entryId: string, updates: Partial<ValueTypeEntrySpec>) => {
    if (updates.name !== undefined && isReservedValueTypeEntryName(updates.name)) {
      toast.error('"Description" is reserved — every property already carries a Description entry')
      return
    }
    if (updates.name !== undefined) {
      const trimmed = sanitizeDotName(updates.name)
      if (trimmed && vt.entries.some((e) => e.id !== entryId && e.name.toLowerCase() === trimmed.toLowerCase())) {
        toast.error(`An entry named "${trimmed}" already exists in this Value Type`)
        return
      }
    }
    onUpdate(vt.id, {
      entries: vt.entries.map((e) => (e.id === entryId ? { ...e, ...updates } : e)),
    })
  }

  return (
    <div className={hideHeader ? '' : 'border-t border-slate-200 dark:border-slate-700 pt-3'}>
      <div className="flex items-center justify-between mb-2">
        {!hideHeader && <h3 className="text-sm font-medium text-slate-700 dark:text-slate-200">Value Types</h3>}
        <AlertDialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm">
              <Plus className="h-3 w-3 mr-1" />
              Add Value Type
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Add Value Type</AlertDialogTitle>
              <AlertDialogDescription>
                Define a named entry template (e.g. CustomerInfo with Name, Address, Phone, Email). New Value Properties
                can copy these entries at creation; no link is kept afterward.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-3 py-2">
              <div className="space-y-1">
                <Label className="text-sm">Name</Label>
                <Input
                  value={newTypeName}
                  onChange={(e) => setNewTypeName(sanitizeDotName(e.target.value))}
                  placeholder="Value type name"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-sm">Description</Label>
                <Textarea
                  value={newTypeDescription}
                  onChange={(e) => setNewTypeDescription(e.target.value)}
                  placeholder="Optional description..."
                  className="min-h-[60px]"
                />
              </div>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={resetDialog}>Cancel</AlertDialogCancel>
              <Button onClick={handleAddType} disabled={!newTypeName.trim()}>
                Add
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <div className="space-y-2">
        {valueTypes.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-slate-500 italic text-center py-2">
            No value types defined. Click "Add Value Type" to define entry templates for new Value Properties.
          </p>
        ) : (
          valueTypes.map((vt) => (
            <div
              key={vt.id}
              className="p-3 bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="p-1.5 bg-teal-100 rounded shrink-0">
                    <Shapes className="h-4 w-4 text-teal-600" />
                  </div>
                  <Input
                    value={vt.name}
                    onChange={(e) => renameType(vt, e.target.value)}
                    className="h-7 text-sm font-medium w-56"
                    placeholder="Value type name"
                  />
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onRemove(vt.id)}
                  className="h-8 w-8 p-0 text-slate-400 dark:text-slate-500 hover:text-red-500"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <div className="pl-10 space-y-2">
                <Input
                  value={vt.description || ''}
                  onChange={(e) => onUpdate(vt.id, { description: e.target.value || undefined })}
                  className="h-7 text-sm"
                  placeholder="Description (optional)"
                />
                <div className="space-y-1">
                  <Label className="text-xs text-slate-500 dark:text-slate-400">Entries:</Label>
                  {vt.entries.map((entry, index) => (
                    <div key={entry.id} className="flex gap-1 items-center">
                      {/* The order here is the order a new Value Property copies the entries in. */}
                      <div className="flex flex-col gap-0.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-3.5 w-4 p-0"
                          onClick={() => onUpdate(vt.id, { entries: arrayMove(vt.entries, index, index - 1) })}
                          disabled={index === 0}
                          title="Move up"
                          aria-label={`Move ${entry.name || 'entry'} up`}
                        >
                          <ArrowUp className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-3.5 w-4 p-0"
                          onClick={() => onUpdate(vt.id, { entries: arrayMove(vt.entries, index, index + 1) })}
                          disabled={index === vt.entries.length - 1}
                          title="Move down"
                          aria-label={`Move ${entry.name || 'entry'} down`}
                        >
                          <ArrowDown className="h-3 w-3" />
                        </Button>
                      </div>
                      <Input
                        value={entry.name}
                        onChange={(e) => updateEntry(vt, entry.id, { name: sanitizeDotName(e.target.value) })}
                        className="h-7 text-sm w-40 shrink-0"
                        placeholder="Entry name"
                      />
                      <Input
                        value={entry.defaultValue || ''}
                        onChange={(e) => updateEntry(vt, entry.id, { defaultValue: e.target.value || undefined })}
                        className="h-7 text-sm flex-1"
                        placeholder="Default value (optional)"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onUpdate(vt.id, { entries: vt.entries.filter((e) => e.id !== entry.id) })}
                        className="h-7 w-7 p-0 text-red-500 hover:text-red-700 dark:hover:text-red-300"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() =>
                      onUpdate(vt.id, {
                        entries: [...vt.entries, { id: generateOID(WORKER_INTERNAL), name: '' }],
                      })
                    }
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Add Entry
                  </Button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
