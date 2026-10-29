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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@mission/ui'
import { Plus, Trash2 } from 'lucide-react'
import type { ResourceSpec, ResourceType } from '@/types/nodes'
import { generateOID, WORKER_INTERNAL } from '@/lib/snowflake'

const RESOURCE_TYPES: ResourceType[] = ['Single Use', 'Shared Use', 'Count Limited', 'Named', 'Sync']

interface ResourcesEditorProps {
  resources: ResourceSpec[]
  onChange: (resources: ResourceSpec[]) => void
  /** When true, displays resources as read-only (no add/edit/delete) */
  readOnly?: boolean
  /** When true, hides the internal "Resources" title (accordion supplies it) */
  hideHeading?: boolean
}

function ResourcesEditorComponent({
  resources,
  onChange,
  readOnly = false,
  hideHeading = false,
}: ResourcesEditorProps) {
  const addResource = useCallback(() => {
    onChange([
      ...resources,
      {
        id: generateOID(WORKER_INTERNAL),
        name: '',
        description: '',
        resourceType: 'Single Use',
        count: 1,
      },
    ])
  }, [resources, onChange])

  const updateResource = useCallback(
    (id: string, updates: Partial<ResourceSpec>) => {
      onChange(
        resources.map((r) => {
          if (r.id !== id) return r
          const updated = { ...r, ...updates }
          // Force count to 1 for Single Use and Sync
          if (updated.resourceType === 'Single Use' || updated.resourceType === 'Sync') {
            updated.count = 1
            updated.names = undefined
          } else if (updated.resourceType === 'Named') {
            if (!updated.names) updated.names = []
            updated.count = updated.names.length
          } else {
            updated.names = undefined
          }
          return updated
        }),
      )
    },
    [resources, onChange],
  )

  const removeResource = useCallback(
    (id: string) => {
      onChange(resources.filter((r) => r.id !== id))
    },
    [resources, onChange],
  )

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        {!hideHeading && <Label className="text-xs font-medium">Resources</Label>}
        {!readOnly && (
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={addResource} aria-label="Add resource">
            <Plus className="h-3 w-3" />
          </Button>
        )}
      </div>

      {resources.length === 0 && (
        <p className="text-xs text-slate-500 dark:text-slate-400 italic">No resources defined</p>
      )}

      {resources.map((r) => (
        <div
          key={r.id}
          className="space-y-1 p-1.5 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700"
        >
          <div className="flex gap-1 items-start">
            <div className="flex-1 space-y-1">
              <Input
                placeholder="Name"
                value={r.name}
                onChange={(e) => updateResource(r.id, { name: e.target.value.replace(/\s/g, '') })}
                className="h-7 text-sm"
                disabled={readOnly}
              />
              <Input
                placeholder="Description (optional)"
                value={r.description || ''}
                onChange={(e) => updateResource(r.id, { description: e.target.value || undefined })}
                className="h-7 text-xs"
                disabled={readOnly}
              />
              <div className="flex gap-1 items-center">
                <Select
                  value={r.resourceType}
                  onValueChange={(value: ResourceType) => updateResource(r.id, { resourceType: value })}
                  disabled={readOnly}
                >
                  <SelectTrigger className="h-7 text-xs flex-1">
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
                {r.resourceType === 'Named' ? (
                  <span className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                    Count: {r.names?.length ?? 0}
                  </span>
                ) : r.resourceType !== 'Single Use' && r.resourceType !== 'Sync' ? (
                  <div className="flex items-center gap-0.5">
                    <Label className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">Count:</Label>
                    <Input
                      type="number"
                      min={1}
                      value={r.count}
                      onChange={(e) => updateResource(r.id, { count: Math.max(1, parseInt(e.target.value) || 1) })}
                      className="w-20 h-7 text-xs"
                      disabled={readOnly}
                    />
                  </div>
                ) : (
                  <span className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">Count: 1</span>
                )}
              </div>
              {r.resourceType === 'Named' && (
                <div className="space-y-1 mt-1">
                  <Label className="text-xs text-slate-500 dark:text-slate-400">Names:</Label>
                  {(r.names || []).map((name, ni) => (
                    <div key={ni} className="flex gap-1 items-center">
                      <Input
                        value={name}
                        onChange={(e) => {
                          const updated = [...(r.names || [])]
                          updated[ni] = e.target.value
                          updateResource(r.id, { names: updated, count: updated.length })
                        }}
                        className="h-6 text-xs flex-1"
                        placeholder={`Name ${ni + 1}`}
                        disabled={readOnly}
                      />
                      {!readOnly && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            const updated = (r.names || []).filter((_, i) => i !== ni)
                            updateResource(r.id, { names: updated, count: updated.length })
                          }}
                          className="h-6 w-6 p-0 text-red-500 hover:text-red-700"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  ))}
                  {!readOnly && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-xs"
                      onClick={() => {
                        const updated = [...(r.names || []), '']
                        updateResource(r.id, { names: updated, count: updated.length })
                      }}
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      Add Name
                    </Button>
                  )}
                </div>
              )}
            </div>
            {!readOnly && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeResource(r.id)}
                className="h-6 w-6 p-0 text-red-500 hover:text-red-700"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

export const ResourcesEditor = memo(ResourcesEditorComponent)
