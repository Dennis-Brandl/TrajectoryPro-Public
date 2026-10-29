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

import { pickLibraryByName } from '@/lib/global-team'
import { useEffect, useMemo } from 'react'
import { Zap } from 'lucide-react'
import { Label } from '@mission/ui'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@mission/ui'
import { useLibraryStore } from '@/stores/libraryStore'
import type { ParameterSpec } from '@/types/nodes'
import type { Specification } from '@/types/library'
import type { SelectedAction } from './action-selection'

interface IncludedAction {
  action_name: string
  action_library: string
}

interface EnvironmentData {
  included_actions?: IncludedAction[]
}

interface WorkflowData {
  environmentSpecIds?: string[]
}

interface ActionData {
  inputs?: ParameterSpec[]
  outputs?: ParameterSpec[]
}

interface AvailableAction {
  id: string
  name: string
  libraryName: string
  libraryId: string
  environmentSpecId: string
  inputs: ParameterSpec[]
  outputs: ParameterSpec[]
}

interface ActionSelectorProps {
  /** Currently selected action (by name for display) */
  selectedActionName?: string
  /** Optional environment spec ID to scope actions to a single environment */
  environmentSpecId?: string
  /** Callback when an action is selected */
  onActionSelect: (action: SelectedAction) => void
}

/**
 * Dropdown component for selecting an action from the environment specifications
 * associated with the current workflow specification.
 */
export function ActionSelector({ selectedActionName, environmentSpecId, onActionSelect }: ActionSelectorProps) {
  const selectedSpecificationId = useLibraryStore((s) => s.selectedSpecificationId)
  const selectedLibraryId = useLibraryStore((s) => s.selectedLibraryId)
  const libraries = useLibraryStore((s) => s.libraries)
  const specifications = useLibraryStore((s) => s.specifications)
  const fetchSpecifications = useLibraryStore((s) => s.fetchSpecifications)

  // Get the current workflow/step specification
  const currentSpecification = useMemo(() => {
    if (!selectedSpecificationId || !selectedLibraryId) return null
    const libSpecs = specifications.get(selectedLibraryId)
    return libSpecs?.find((s) => s.id === selectedSpecificationId) || null
  }, [selectedSpecificationId, selectedLibraryId, specifications])

  // Get environment specification IDs from the current specification
  // When environmentSpecId prop is provided, scope to that single environment
  const environmentSpecIds = useMemo(() => {
    if (environmentSpecId) return [environmentSpecId]
    if (!currentSpecification) return []
    const specData = currentSpecification.data as WorkflowData | undefined
    return specData?.environmentSpecIds || []
  }, [environmentSpecId, currentSpecification])

  // Get all action libraries and fetch their specifications
  const actionLibraries = useMemo(() => libraries.filter((lib) => lib.entityType === 'action'), [libraries])

  // Fetch action library specifications when needed
  useEffect(() => {
    for (const lib of actionLibraries) {
      if (!specifications.has(lib.id)) {
        fetchSpecifications(lib.id)
      }
    }
  }, [actionLibraries, specifications, fetchSpecifications])

  // Build list of available actions from selected environment specifications
  const availableActions = useMemo(() => {
    // Find environment spec by ID across all libraries
    const findEnvSpec = (specId: string): Specification | null => {
      for (const specs of specifications.values()) {
        const found = specs.find((s) => s.id === specId)
        if (found) return found
      }
      return null
    }

    const actions: AvailableAction[] = []

    // For each environment specification associated with the workflow
    for (const envSpecId of environmentSpecIds) {
      const envSpec = findEnvSpec(envSpecId)
      if (!envSpec) continue

      const envData = envSpec.data as EnvironmentData
      const includedActions = envData?.included_actions || []

      // For each included action reference in the environment
      for (const actionRef of includedActions) {
        // Find the action library by name
        // Team library wins over GLOBAL's (spec 2026-10-12 U4); prefer the environment's own team.
        const envTeamId = libraries.find((l) => l.id === envSpec.libraryId)?.teamId
        const actionLib = pickLibraryByName(actionLibraries, actionRef.action_library, 'action', envTeamId)
        if (!actionLib) continue

        // Get action specifications in that library
        const actionSpecs = specifications.get(actionLib.id) || []

        // Find the specific action by name
        const actionSpec = actionSpecs.find((spec) => spec.name === actionRef.action_name)
        if (!actionSpec) continue

        const actionData = actionSpec.data as ActionData

        // Check for duplicates
        const alreadyAdded = actions.some((a) => a.name === actionSpec.name && a.libraryName === actionLib.name)
        if (alreadyAdded) continue

        actions.push({
          id: actionSpec.id,
          name: actionSpec.name,
          libraryName: actionLib.name,
          libraryId: actionLib.id,
          environmentSpecId: envSpecId,
          inputs: actionData?.inputs || [],
          outputs: actionData?.outputs || [],
        })
      }
    }

    return actions
  }, [environmentSpecIds, specifications, actionLibraries, libraries])

  const handleActionSelect = (actionId: string) => {
    const action = availableActions.find((a) => a.id === actionId)
    if (action) {
      onActionSelect({
        name: action.name,
        libraryName: action.libraryName,
        actionOid: action.id,
        environmentSpecId: action.environmentSpecId,
        inputs: action.inputs,
        outputs: action.outputs,
      })
    }
  }

  // Find currently selected action ID for the dropdown
  const selectedActionId = useMemo(() => {
    if (!selectedActionName) return ''
    const action = availableActions.find((a) => a.name === selectedActionName)
    return action?.id || ''
  }, [selectedActionName, availableActions])

  return (
    <div className="space-y-1">
      <Label className="text-sm">Action Reference</Label>
      {availableActions.length > 0 ? (
        <Select value={selectedActionId} onValueChange={handleActionSelect}>
          <SelectTrigger className="h-8">
            <SelectValue placeholder="Select action..." />
          </SelectTrigger>
          <SelectContent>
            {availableActions.map((action) => (
              <SelectItem key={action.id} value={action.id}>
                <div className="flex items-center gap-2">
                  <Zap className="h-3 w-3 text-amber-600" />
                  <span>{action.name}</span>
                  <span className="text-xs text-slate-400 dark:text-slate-500">({action.libraryName})</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : environmentSpecIds.length === 0 ? (
        <p className="text-xs text-slate-400 dark:text-slate-500 italic">
          No environments associated with this specification. Add environments in the header above.
        </p>
      ) : (
        <p className="text-xs text-slate-400 dark:text-slate-500 italic">
          No actions available in the associated environments.
        </p>
      )}
      {selectedActionName && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Selected: <span className="font-medium">{selectedActionName}</span>
        </p>
      )}
    </div>
  )
}
