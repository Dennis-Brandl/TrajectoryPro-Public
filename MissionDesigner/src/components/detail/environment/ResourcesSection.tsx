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
import { Trash2, Plus, Box } from 'lucide-react'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@mission/ui'
import { generateOID, WORKER_INTERNAL } from '@/lib/snowflake'
import type { ResourceSpec, ResourceType } from '@/types/nodes'

export const RESOURCE_TYPES: ResourceType[] = ['Single Use', 'Shared Use', 'Count Limited', 'Named', 'Sync']

export interface ResourcesSectionProps {
  resources: ResourceSpec[]
  onAdd: (resource: ResourceSpec) => void
  onRemove: (id: string) => void
  onUpdate: (id: string, updates: Partial<ResourceSpec>) => void
  hideHeader?: boolean
}

/**
 * Manages the "Resources" section of the Environment detail form.
 * Handles the "Add Resource" dialog and the inline edit list.
 */
export function ResourcesSection({ resources, onAdd, onRemove, onUpdate, hideHeader = false }: ResourcesSectionProps) {
  const [isAddResourceDialogOpen, setIsAddResourceDialogOpen] = useState(false)
  const [newResourceName, setNewResourceName] = useState('')
  const [newResourceDescription, setNewResourceDescription] = useState('')
  const [newResourceType, setNewResourceType] = useState<ResourceType>('Single Use')
  const [newResourceCount, setNewResourceCount] = useState(1)
  const [newResourceNames, setNewResourceNames] = useState<string[]>([])

  const resetDialog = () => {
    setNewResourceName('')
    setNewResourceDescription('')
    setNewResourceType('Single Use')
    setNewResourceCount(1)
    setNewResourceNames([])
  }

  const handleAddResource = () => {
    if (!newResourceName.trim()) return

    const newResource: ResourceSpec = {
      id: generateOID(WORKER_INTERNAL),
      name: newResourceName.trim(),
      description: newResourceDescription.trim() || undefined,
      resourceType: newResourceType,
      count:
        newResourceType === 'Single Use' || newResourceType === 'Sync'
          ? 1
          : newResourceType === 'Named'
            ? newResourceNames.length
            : newResourceCount,
      ...(newResourceType === 'Named' ? { names: newResourceNames } : {}),
    }

    onAdd(newResource)
    resetDialog()
    setIsAddResourceDialogOpen(false)
  }

  return (
    <div className={hideHeader ? '' : 'border-t border-slate-200 dark:border-slate-700 pt-3'}>
      <div className="flex items-center justify-between mb-2">
        {!hideHeader && <h3 className="text-sm font-medium text-slate-700 dark:text-slate-200">Resources</h3>}
        <AlertDialog open={isAddResourceDialogOpen} onOpenChange={setIsAddResourceDialogOpen}>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm">
              <Plus className="h-3 w-3 mr-1" />
              Add Resource
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Add Resource</AlertDialogTitle>
              <AlertDialogDescription>
                Define a resource that workflows can claim or access during execution.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-3 py-2">
              <div className="space-y-1">
                <Label className="text-sm">Name</Label>
                <Input
                  value={newResourceName}
                  onChange={(e) => setNewResourceName(e.target.value.replace(/\s/g, ''))}
                  placeholder="Resource name"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-sm">Description</Label>
                <Textarea
                  value={newResourceDescription}
                  onChange={(e) => setNewResourceDescription(e.target.value)}
                  placeholder="Optional description..."
                  className="min-h-[60px]"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-sm">Type</Label>
                <Select
                  value={newResourceType}
                  onValueChange={(value: ResourceType) => {
                    setNewResourceType(value)
                    if (value === 'Single Use' || value === 'Sync') {
                      setNewResourceCount(1)
                    }
                    if (value === 'Named') {
                      setNewResourceNames([])
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RESOURCE_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {newResourceType === 'Named' ? (
                <div className="space-y-1">
                  <Label className="text-sm">Names ({newResourceNames.length})</Label>
                  {newResourceNames.map((name, ni) => (
                    <div key={ni} className="flex gap-1 items-center">
                      <Input
                        value={name}
                        onChange={(e) => {
                          const updated = [...newResourceNames]
                          updated[ni] = e.target.value
                          setNewResourceNames(updated)
                        }}
                        placeholder={`Name ${ni + 1}`}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setNewResourceNames(newResourceNames.filter((_, i) => i !== ni))}
                        className="h-8 w-8 p-0 text-red-500 hover:text-red-700 dark:hover:text-red-300"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={() => setNewResourceNames([...newResourceNames, ''])}>
                    <Plus className="h-3 w-3 mr-1" />
                    Add Name
                  </Button>
                </div>
              ) : newResourceType === 'Single Use' || newResourceType === 'Sync' ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">Count: 1 (fixed)</p>
              ) : (
                <div className="space-y-1">
                  <Label className="text-sm">Count</Label>
                  <Input
                    type="number"
                    min={1}
                    value={newResourceCount}
                    onChange={(e) => setNewResourceCount(Math.max(1, parseInt(e.target.value) || 1))}
                  />
                </div>
              )}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={resetDialog}>Cancel</AlertDialogCancel>
              <Button onClick={handleAddResource} disabled={!newResourceName.trim()}>
                Add Resource
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <div className="space-y-2">
        {resources.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-slate-500 italic text-center py-2">
            No resources defined. Click "Add Resource" to define resources for this environment.
          </p>
        ) : (
          resources.map((resource) => (
            <div
              key={resource.id}
              className="p-3 bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="p-1.5 bg-purple-100 rounded shrink-0">
                    <Box className="h-4 w-4 text-purple-600" />
                  </div>
                  <div className="min-w-0">
                    <Input
                      value={resource.name}
                      onChange={(e) => onUpdate(resource.id, { name: e.target.value.replace(/\s/g, '') })}
                      className="h-7 text-sm font-medium w-56"
                      placeholder="Resource name"
                    />
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onRemove(resource.id)}
                  className="h-8 w-8 p-0 text-slate-400 dark:text-slate-500 hover:text-red-500"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <div className="pl-10 space-y-2">
                <Input
                  value={resource.description || ''}
                  onChange={(e) => onUpdate(resource.id, { description: e.target.value || undefined })}
                  className="h-7 text-sm"
                  placeholder="Description (optional)"
                />
                <div className="flex items-center gap-2">
                  <Select
                    value={resource.resourceType}
                    onValueChange={(value: ResourceType) => onUpdate(resource.id, { resourceType: value })}
                  >
                    <SelectTrigger className="w-40 h-7 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RESOURCE_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          {type}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {resource.resourceType === 'Named' ? (
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      Count: {resource.names?.length ?? 0}
                    </span>
                  ) : resource.resourceType !== 'Single Use' && resource.resourceType !== 'Sync' ? (
                    <div className="flex items-center gap-1">
                      <Label className="text-xs text-slate-500 dark:text-slate-400">Count:</Label>
                      <Input
                        type="number"
                        min={1}
                        value={resource.count}
                        onChange={(e) =>
                          onUpdate(resource.id, {
                            count: Math.max(1, parseInt(e.target.value) || 1),
                          })
                        }
                        className="w-16 h-7 text-sm"
                      />
                    </div>
                  ) : (
                    <span className="text-xs text-slate-500 dark:text-slate-400">Count: 1 (fixed)</span>
                  )}
                </div>
                {resource.resourceType === 'Named' && (
                  <div className="space-y-1 mt-1">
                    <Label className="text-xs text-slate-500 dark:text-slate-400">Names:</Label>
                    {(resource.names || []).map((name, ni) => (
                      <div key={ni} className="flex gap-1 items-center">
                        <Input
                          value={name}
                          onChange={(e) => {
                            const updated = [...(resource.names || [])]
                            updated[ni] = e.target.value
                            onUpdate(resource.id, { names: updated, count: updated.length })
                          }}
                          className="h-7 text-sm flex-1"
                          placeholder={`Name ${ni + 1}`}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            const updated = (resource.names || []).filter((_, i) => i !== ni)
                            onUpdate(resource.id, { names: updated, count: updated.length })
                          }}
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
                      onClick={() => {
                        const updated = [...(resource.names || []), '']
                        onUpdate(resource.id, { names: updated, count: updated.length })
                      }}
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      Add Name
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
