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

import { memo, useCallback, useMemo } from 'react'
import { Button } from '@mission/ui'
import { Input } from '@mission/ui'
import { Label } from '@mission/ui'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@mission/ui'
import { Plus, Trash2 } from 'lucide-react'
import { useAvailableResources, type ResourceGroup } from '@/hooks/useAvailableResources'
import { OutputParameterSelect } from './OutputParameterSelect'
import { SendSourceSelect } from './SendSourceSelect'
import type { StepResourceCommand, ResourceCommandType } from '@/types/nodes'
import { generateOID, WORKER_INTERNAL } from '@/lib/snowflake'

const SYNC_COMMAND_TYPES: ResourceCommandType[] = ['Send', 'Receive', 'Synchronize']

interface ResourceCommandEditorProps {
  resourceCommands: StepResourceCommand[]
  onChange: (resourceCommands: StepResourceCommand[]) => void
  readOnly?: boolean
  /** When true, hides the empty-state "Resource Commands" title (accordion supplies it) */
  hideHeading?: boolean
}

function ResourceCommandEditorComponent({
  resourceCommands,
  onChange,
  readOnly = false,
  hideHeading = false,
}: ResourceCommandEditorProps) {
  const { groups, allResources } = useAvailableResources()
  const hasResources = allResources.size > 0

  // Split commands into acquire, release, and sync groups. Memoized on their
  // inputs so the add-callbacks below keep stable dependencies.
  const acquireCommands = useMemo(
    () => resourceCommands.filter((cmd) => cmd.commandType === 'Acquire'),
    [resourceCommands],
  )
  const releaseCommands = useMemo(
    () => resourceCommands.filter((cmd) => cmd.commandType === 'Release'),
    [resourceCommands],
  )
  const syncCommands = resourceCommands.filter((cmd) => {
    const spec = allResources.get(cmd.resourceName)
    return spec?.resourceType === 'Sync' || SYNC_COMMAND_TYPES.includes(cmd.commandType)
  })

  // Resources already used in each section (by name)
  const acquireNames = useMemo(() => new Set(acquireCommands.map((c) => c.resourceName)), [acquireCommands])
  const releaseNames = useMemo(() => new Set(releaseCommands.map((c) => c.resourceName)), [releaseCommands])
  const hasSyncCommand = syncCommands.length > 0

  // Standard (non-Sync) resources
  const standardResources = useMemo(
    () => [...allResources.entries()].filter(([, spec]) => spec.resourceType !== 'Sync'),
    [allResources],
  )
  const syncResources = useMemo(
    () => [...allResources.entries()].filter(([, spec]) => spec.resourceType === 'Sync'),
    [allResources],
  )

  const canAddAcquire = standardResources.some(([name]) => !acquireNames.has(name))
  const canAddRelease = standardResources.some(([name]) => !releaseNames.has(name))
  const canAddSync = syncResources.length > 0 && !hasSyncCommand

  const addAcquire = useCallback(() => {
    const entry = standardResources.find(([name]) => !acquireNames.has(name))
    if (!entry) return
    const source = findResourceSource(entry[0], groups)
    onChange([
      ...resourceCommands,
      {
        id: generateOID(WORKER_INTERNAL),
        resourceName: entry[0],
        resourceSourceType: source?.sourceType,
        resourceSourceOid: source?.sourceOid,
        commandType: 'Acquire',
        count: 1,
      },
    ])
  }, [resourceCommands, standardResources, acquireNames, groups, onChange])

  const addRelease = useCallback(() => {
    const entry = standardResources.find(([name]) => !releaseNames.has(name))
    if (!entry) return
    const source = findResourceSource(entry[0], groups)
    onChange([
      ...resourceCommands,
      {
        id: generateOID(WORKER_INTERNAL),
        resourceName: entry[0],
        resourceSourceType: source?.sourceType,
        resourceSourceOid: source?.sourceOid,
        commandType: 'Release',
        count: 1,
      },
    ])
  }, [resourceCommands, standardResources, releaseNames, groups, onChange])

  const addSync = useCallback(() => {
    const entry = syncResources[0]
    if (!entry) return
    const source = findResourceSource(entry[0], groups)
    onChange([
      ...resourceCommands,
      {
        id: generateOID(WORKER_INTERNAL),
        resourceName: entry[0],
        resourceSourceType: source?.sourceType,
        resourceSourceOid: source?.sourceOid,
        commandType: 'Send',
        count: 1,
      },
    ])
  }, [resourceCommands, syncResources, groups, onChange])

  const updateCommand = useCallback(
    (id: string, updates: Partial<StepResourceCommand>) => {
      onChange(resourceCommands.map((cmd) => (cmd.id === id ? { ...cmd, ...updates } : cmd)))
    },
    [resourceCommands, onChange],
  )

  const removeCommand = useCallback(
    (id: string) => {
      onChange(resourceCommands.filter((cmd) => cmd.id !== id))
    },
    [resourceCommands, onChange],
  )

  if (!hasResources && !readOnly) {
    return (
      <div className="space-y-2">
        {!hideHeading && <Label className="text-xs font-medium">Resource Commands</Label>}
        <p className="text-xs text-slate-500 dark:text-slate-400 italic">
          No resources available. Add resources to the workflow or environment.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Acquire at Step Start */}
      <CommandSection
        label="Acquire at Step Start"
        commands={acquireCommands}
        commandType="Acquire"
        groups={groups}
        allResources={allResources}
        onAdd={addAcquire}
        canAdd={canAddAcquire}
        onUpdate={updateCommand}
        onRemove={removeCommand}
        readOnly={readOnly}
      />

      {/* Release at Step End */}
      <CommandSection
        label="Release at Step End"
        commands={releaseCommands}
        commandType="Release"
        groups={groups}
        allResources={allResources}
        onAdd={addRelease}
        canAdd={canAddRelease}
        onUpdate={updateCommand}
        onRemove={removeCommand}
        readOnly={readOnly}
      />

      {/* Sync Commands (max 1 per step) */}
      {(syncResources.length > 0 || syncCommands.length > 0) && (
        <SyncSection
          commands={syncCommands}
          groups={groups}
          allResources={allResources}
          canAdd={canAddSync}
          onAdd={addSync}
          onUpdate={updateCommand}
          onRemove={removeCommand}
          readOnly={readOnly}
        />
      )}
    </div>
  )
}

/** Section for Acquire or Release commands */
function CommandSection({
  label,
  commands,
  commandType,
  groups,
  allResources,
  onAdd,
  canAdd,
  onUpdate,
  onRemove,
  readOnly,
}: {
  label: string
  commands: StepResourceCommand[]
  commandType: 'Acquire' | 'Release'
  groups: ReturnType<typeof useAvailableResources>['groups']
  allResources: Map<string, { resourceType: string; count?: number; names?: string[] }>
  onAdd: () => void
  canAdd: boolean
  onUpdate: (id: string, updates: Partial<StepResourceCommand>) => void
  onRemove: (id: string) => void
  readOnly: boolean
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium">{label}</Label>
        {!readOnly && (
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onAdd} disabled={!canAdd}>
            <Plus className="h-3 w-3" />
          </Button>
        )}
      </div>

      {commands.length === 0 && <p className="text-xs text-slate-500 dark:text-slate-400 italic">None</p>}

      {commands.map((cmd) => {
        const resourceSpec = allResources.get(cmd.resourceName)
        const isCountLimited = resourceSpec?.resourceType === 'Count Limited'
        const isUnresolved = !!cmd.resourceName && !allResources.has(cmd.resourceName)

        // Names used by OTHER commands in this section
        const otherNames = new Set(commands.filter((c) => c.id !== cmd.id).map((c) => c.resourceName))

        return (
          <div
            key={cmd.id}
            className="space-y-1 p-1.5 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700"
          >
            <div className="flex gap-1 items-start">
              <div className="flex-1 space-y-1">
                {/* Resource Name */}
                <Select
                  value={cmd.resourceName}
                  onValueChange={(value) => updateCommand(cmd.id, value, groups, onUpdate)}
                  disabled={readOnly}
                >
                  <SelectTrigger className={`h-7 text-xs ${isUnresolved ? 'border-amber-400 text-amber-700' : ''}`}>
                    <SelectValue placeholder="Select resource...">
                      {isUnresolved
                        ? `${cmd.resourceName} (unresolved)`
                        : cmd.resourceName
                          ? `${cmd.resourceName} (${resourceSpec?.resourceType || ''})`
                          : undefined}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {groups.map((group, gi) => {
                      const available = group.resources.filter((r) => {
                        if (!r.name || r.resourceType === 'Sync') return false
                        return r.name === cmd.resourceName || !otherNames.has(r.name)
                      })
                      if (available.length === 0) return null
                      return (
                        <SelectGroup key={gi}>
                          <SelectLabel>{group.label}</SelectLabel>
                          {available.map((resource) => (
                            <SelectItem key={resource.id} value={resource.name}>
                              {resource.name}
                              <span className="text-slate-400 dark:text-slate-500 ml-1 text-xs">
                                ({resource.resourceType})
                              </span>
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      )
                    })}
                    {isUnresolved && (
                      <>
                        <SelectSeparator />
                        <SelectGroup>
                          <SelectLabel className="text-amber-600">Unresolved</SelectLabel>
                          <SelectItem value={cmd.resourceName} className="text-amber-700">
                            {cmd.resourceName} (unresolved)
                          </SelectItem>
                        </SelectGroup>
                      </>
                    )}
                  </SelectContent>
                </Select>

                {/* Count */}
                <div className="flex gap-1 items-center">
                  {isCountLimited ? (
                    <div className="flex items-center gap-0.5">
                      <Label className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">Count:</Label>
                      <Input
                        type="number"
                        min={1}
                        value={cmd.count}
                        onChange={(e) => onUpdate(cmd.id, { count: Math.max(1, parseInt(e.target.value) || 1) })}
                        className="w-20 h-7 text-xs"
                        disabled={readOnly}
                      />
                    </div>
                  ) : (
                    <span className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">Count: 1</span>
                  )}
                </div>

                {/* Named + Acquire: store acquired name */}
                {resourceSpec?.resourceType === 'Named' && commandType === 'Acquire' && (
                  <div className="space-y-0.5">
                    <Label className="text-xs text-slate-500 dark:text-slate-400">Store acquired name to:</Label>
                    <OutputParameterSelect
                      value={cmd.target}
                      onChange={(value) => onUpdate(cmd.id, { target: value || undefined })}
                      readOnly={readOnly}
                    />
                  </div>
                )}

                {/* Named + Release: specify which named resource to release */}
                {resourceSpec?.resourceType === 'Named' && commandType === 'Release' && (
                  <div className="space-y-0.5">
                    <Label className="text-xs text-slate-500 dark:text-slate-400">Release resource stored in:</Label>
                    <OutputParameterSelect
                      value={cmd.target}
                      onChange={(value) => onUpdate(cmd.id, { target: value || undefined })}
                      readOnly={readOnly}
                    />
                  </div>
                )}
              </div>

              {!readOnly && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onRemove(cmd.id)}
                  className="h-6 w-6 p-0 text-red-500 hover:text-red-700"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** Section for Sync resource commands */
function SyncSection({
  commands,
  groups,
  allResources,
  canAdd,
  onAdd,
  onUpdate,
  onRemove,
  readOnly,
}: {
  commands: StepResourceCommand[]
  groups: ReturnType<typeof useAvailableResources>['groups']
  allResources: Map<string, { resourceType: string; count?: number; names?: string[] }>
  canAdd: boolean
  onAdd: () => void
  onUpdate: (id: string, updates: Partial<StepResourceCommand>) => void
  onRemove: (id: string) => void
  readOnly: boolean
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium">Sync Command</Label>
        {!readOnly && (
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onAdd} disabled={!canAdd}>
            <Plus className="h-3 w-3" />
          </Button>
        )}
      </div>

      {commands.length === 0 && <p className="text-xs text-slate-500 dark:text-slate-400 italic">None</p>}

      {commands.map((cmd) => {
        const isUnresolved = !!cmd.resourceName && !allResources.has(cmd.resourceName)

        return (
          <div
            key={cmd.id}
            className="space-y-1 p-1.5 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700"
          >
            <div className="flex gap-1 items-start">
              <div className="flex-1 space-y-1">
                {/* Resource Name */}
                <Select
                  value={cmd.resourceName}
                  onValueChange={(value) => {
                    const source = findResourceSource(value, groups)
                    onUpdate(cmd.id, {
                      resourceName: value,
                      resourceSourceType: source?.sourceType,
                      resourceSourceOid: source?.sourceOid,
                    })
                  }}
                  disabled={readOnly}
                >
                  <SelectTrigger className={`h-7 text-xs ${isUnresolved ? 'border-amber-400 text-amber-700' : ''}`}>
                    <SelectValue placeholder="Select resource...">
                      {isUnresolved ? `${cmd.resourceName} (unresolved)` : cmd.resourceName || undefined}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {groups.map((group, gi) => {
                      const available = group.resources.filter((r) => r.name && r.resourceType === 'Sync')
                      if (available.length === 0) return null
                      return (
                        <SelectGroup key={gi}>
                          <SelectLabel>{group.label}</SelectLabel>
                          {available.map((resource) => (
                            <SelectItem key={resource.id} value={resource.name}>
                              {resource.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      )
                    })}
                    {isUnresolved && (
                      <>
                        <SelectSeparator />
                        <SelectGroup>
                          <SelectLabel className="text-amber-600">Unresolved</SelectLabel>
                          <SelectItem value={cmd.resourceName} className="text-amber-700">
                            {cmd.resourceName} (unresolved)
                          </SelectItem>
                        </SelectGroup>
                      </>
                    )}
                  </SelectContent>
                </Select>

                {/* Command Type */}
                <Select
                  value={cmd.commandType}
                  onValueChange={(value: ResourceCommandType) =>
                    onUpdate(cmd.id, { commandType: value, source: undefined, target: undefined })
                  }
                  disabled={readOnly}
                >
                  <SelectTrigger className="h-7 text-xs w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SYNC_COMMAND_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Sync Send: parameter to send */}
                {cmd.commandType === 'Send' && (
                  <div className="space-y-0.5">
                    <Label className="text-xs text-slate-500 dark:text-slate-400">Parameter to send:</Label>
                    <SendSourceSelect
                      value={cmd.source}
                      onChange={(value) => onUpdate(cmd.id, { source: value })}
                      readOnly={readOnly}
                    />
                  </div>
                )}
                {/* Sync Receive: store received value */}
                {cmd.commandType === 'Receive' && (
                  <div className="space-y-0.5">
                    <Label className="text-xs text-slate-500 dark:text-slate-400">Store received value to:</Label>
                    <OutputParameterSelect
                      value={cmd.target}
                      onChange={(value) => onUpdate(cmd.id, { target: value || undefined })}
                      readOnly={readOnly}
                      includePropertyNames
                    />
                  </div>
                )}
              </div>

              {!readOnly && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onRemove(cmd.id)}
                  className="h-6 w-6 p-0 text-red-500 hover:text-red-700"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** Helper: when changing resource name, update source info from groups */
function updateCommand(
  id: string,
  newResourceName: string,
  groups: ResourceGroup[],
  onUpdate: (id: string, updates: Partial<StepResourceCommand>) => void,
) {
  const source = findResourceSource(newResourceName, groups)
  onUpdate(id, {
    resourceName: newResourceName,
    resourceSourceType: source?.sourceType,
    resourceSourceOid: source?.sourceOid,
  })
}

/** Look up which group a resource belongs to and return its source info */
function findResourceSource(
  resourceName: string,
  groups: ResourceGroup[],
): { sourceType: 'workflow' | 'environment'; sourceOid: string } | undefined {
  for (const group of groups) {
    if (group.resources.some((r) => r.name === resourceName)) {
      return { sourceType: group.sourceType, sourceOid: group.sourceOid }
    }
  }
  return undefined
}

export const ResourceCommandEditor = memo(ResourceCommandEditorComponent)
