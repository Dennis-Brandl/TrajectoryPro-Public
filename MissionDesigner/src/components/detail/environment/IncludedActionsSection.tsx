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

import { libraryLabel, pickableLibraries } from '@/lib/global-team'
import { useState, useEffect } from 'react'
import { Trash2, Plus, Zap, Library } from 'lucide-react'
import { Button } from '@mission/ui'
import { Label } from '@mission/ui'
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
import { useLibraryStore } from '@/stores/libraryStore'

export interface IncludedAction {
  action_name: string
  action_library: string
}

export interface IncludedActionsSectionProps {
  includedActions: IncludedAction[]
  onAdd: (action: IncludedAction) => void
  onAddAll: (actions: IncludedAction[]) => void
  onRemove: (index: number) => void
  hideHeader?: boolean
  /** The environment's team: a saved bare library name resolves preferring it (spec 2026-10-12 U4). */
  environmentTeamId?: string | null
}

/**
 * Manages the "Included Actions" section of the Environment detail form.
 * Handles dialogs for adding individual actions or all actions from a library.
 */
export function IncludedActionsSection({
  includedActions,
  onAdd,
  onAddAll,
  onRemove,
  hideHeader = false,
  environmentTeamId,
}: IncludedActionsSectionProps) {
  // Only the library each saved name resolves to: offering GLOBAL's X beside the team's X would
  // save a reference that silently points at the team's.
  const actionLibraries = pickableLibraries(
    useLibraryStore((s) => s.libraries),
    'action',
    environmentTeamId,
  )
  const specifications = useLibraryStore((s) => s.specifications)
  const fetchSpecifications = useLibraryStore((s) => s.fetchSpecifications)

  // Add Action Reference dialog state
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [selectedLibraryId, setSelectedLibraryId] = useState<string>('')
  const [selectedActionId, setSelectedActionId] = useState<string>('')

  // Add All from Library dialog state
  const [isAddAllDialogOpen, setIsAddAllDialogOpen] = useState(false)
  const [addAllLibraryId, setAddAllLibraryId] = useState<string>('')

  const actionsInSelectedLibrary = selectedLibraryId ? specifications.get(selectedLibraryId) || [] : []

  // Fetch actions when a library is selected in either dialog
  useEffect(() => {
    if (selectedLibraryId && !specifications.has(selectedLibraryId)) {
      fetchSpecifications(selectedLibraryId)
    }
  }, [selectedLibraryId, specifications, fetchSpecifications])

  useEffect(() => {
    if (addAllLibraryId && !specifications.has(addAllLibraryId)) {
      fetchSpecifications(addAllLibraryId)
    }
  }, [addAllLibraryId, specifications, fetchSpecifications])

  const handleAddAction = () => {
    if (!selectedLibraryId || !selectedActionId) return

    const library = actionLibraries.find((lib) => lib.id === selectedLibraryId)
    const action = actionsInSelectedLibrary.find((a) => a.id === selectedActionId)

    if (!library || !action) return

    const alreadyExists = includedActions.some(
      (a) => a.action_name === action.name && a.action_library === library.name,
    )

    if (!alreadyExists) {
      onAdd({ action_name: action.name, action_library: library.name })
    }

    setSelectedLibraryId('')
    setSelectedActionId('')
    setIsAddDialogOpen(false)
  }

  const handleAddAllFromLibrary = () => {
    if (!addAllLibraryId) return

    const library = actionLibraries.find((lib) => lib.id === addAllLibraryId)
    const actions = specifications.get(addAllLibraryId) || []

    if (!library || actions.length === 0) return

    const newActions: IncludedAction[] = []
    for (const action of actions) {
      const alreadyExists = includedActions.some(
        (a) => a.action_name === action.name && a.action_library === library.name,
      )
      if (!alreadyExists) {
        newActions.push({ action_name: action.name, action_library: library.name })
      }
    }

    if (newActions.length > 0) {
      onAddAll(newActions)
    }

    setAddAllLibraryId('')
    setIsAddAllDialogOpen(false)
  }

  return (
    <div className={hideHeader ? '' : 'border-t border-slate-200 dark:border-slate-700 pt-3'}>
      <div className="flex items-center justify-between mb-2">
        {!hideHeader && <h3 className="text-sm font-medium text-slate-700 dark:text-slate-200">Included Actions</h3>}
        <div className={`flex items-center gap-2 ${hideHeader ? 'ml-auto' : ''}`}>
          <AlertDialog open={isAddAllDialogOpen} onOpenChange={setIsAddAllDialogOpen}>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Library className="h-3 w-3 mr-1" />
                Add All from Library
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Add All Actions from Library</AlertDialogTitle>
                <AlertDialogDescription>
                  Select an action library to include all of its actions in this environment. Actions already included
                  will be skipped.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="space-y-2 py-2">
                <div className="space-y-2">
                  <Label className="text-sm">Action Library</Label>
                  <Select value={addAllLibraryId} onValueChange={setAddAllLibraryId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a library..." />
                    </SelectTrigger>
                    <SelectContent>
                      {actionLibraries.map((lib) => (
                        <SelectItem key={lib.id} value={lib.id}>
                          {libraryLabel(lib)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {addAllLibraryId && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {(specifications.get(addAllLibraryId) || []).length} action(s) in this library
                  </p>
                )}
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel onClick={() => setAddAllLibraryId('')}>Cancel</AlertDialogCancel>
                <Button
                  onClick={handleAddAllFromLibrary}
                  disabled={!addAllLibraryId || (specifications.get(addAllLibraryId) || []).length === 0}
                >
                  Add All
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <AlertDialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Plus className="h-3 w-3 mr-1" />
                Add Action
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Add Action Reference</AlertDialogTitle>
                <AlertDialogDescription>
                  Select an action from an action library to include in this environment.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="space-y-2 py-2">
                <div className="space-y-2">
                  <Label className="text-sm">Action Library</Label>
                  <Select
                    value={selectedLibraryId}
                    onValueChange={(value) => {
                      setSelectedLibraryId(value)
                      setSelectedActionId('')
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a library..." />
                    </SelectTrigger>
                    <SelectContent>
                      {actionLibraries.map((lib) => (
                        <SelectItem key={lib.id} value={lib.id}>
                          {libraryLabel(lib)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm">Action</Label>
                  <Select value={selectedActionId} onValueChange={setSelectedActionId} disabled={!selectedLibraryId}>
                    <SelectTrigger>
                      <SelectValue placeholder={selectedLibraryId ? 'Select an action...' : 'Select a library first'} />
                    </SelectTrigger>
                    <SelectContent>
                      {actionsInSelectedLibrary.map((action) => (
                        <SelectItem key={action.id} value={action.id}>
                          {action.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel
                  onClick={() => {
                    setSelectedLibraryId('')
                    setSelectedActionId('')
                  }}
                >
                  Cancel
                </AlertDialogCancel>
                <Button onClick={handleAddAction} disabled={!selectedLibraryId || !selectedActionId}>
                  Add Action
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <div className="space-y-2">
        {includedActions.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-slate-500 italic text-center py-2">
            No actions included. Add actions individually or add all from a library.
          </p>
        ) : (
          includedActions.map((action, index) => (
            <div
              key={`${action.action_library}-${action.action_name}-${index}`}
              className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700"
            >
              <div className="flex items-center gap-3">
                <div className="p-1.5 bg-amber-100 rounded">
                  <Zap className="h-4 w-4 text-amber-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{action.action_name}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">from {action.action_library}</p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onRemove(index)}
                className="h-8 w-8 p-0 text-slate-400 dark:text-slate-500 hover:text-red-500"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
