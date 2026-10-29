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

import { useEffect, useMemo, useState } from 'react'
import { Zap, Search, Check } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@mission/ui'
import { Button } from '@mission/ui'
import { Input } from '@mission/ui'
import { ScrollArea } from '@mission/ui'
import { useLibraryStore } from '@/stores/libraryStore'

interface AvailableAction {
  id: string
  name: string
  libraryName: string
  libraryId: string
}

interface IncludedAction {
  action_name: string
  action_library: string
}

interface ActionPickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Already included actions to show as selected */
  includedActions: IncludedAction[]
  /** Callback when actions are confirmed */
  onConfirm: (actions: IncludedAction[]) => void
}

/**
 * Dialog for browsing and selecting actions from action libraries.
 * Shows all available actions with checkboxes to include/exclude.
 */
export function ActionPickerDialog({ open, onOpenChange, includedActions, onConfirm }: ActionPickerDialogProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedActions, setSelectedActions] = useState<Set<string>>(new Set())

  const libraries = useLibraryStore((s) => s.libraries)
  const specifications = useLibraryStore((s) => s.specifications)
  const fetchSpecifications = useLibraryStore((s) => s.fetchSpecifications)

  // Get all action libraries
  const actionLibraries = useMemo(() => libraries.filter((lib) => lib.entityType === 'action'), [libraries])

  // Fetch action library specifications when dialog opens
  useEffect(() => {
    if (open) {
      for (const lib of actionLibraries) {
        if (!specifications.has(lib.id)) {
          fetchSpecifications(lib.id)
        }
      }
    }
  }, [open, actionLibraries, specifications, fetchSpecifications])

  // Build key for included actions (for Set lookups)
  const actionKey = (name: string, library: string) => `${library}::${name}`

  // Seed the selection from props whenever the dialog opens. Adjust-state-
  // during-render (react.dev "storing information from previous renders")
  // rather than an effect.
  const [seededFrom, setSeededFrom] = useState<{ open: boolean; includedActions: IncludedAction[] } | null>(null)
  if (seededFrom?.open !== open || seededFrom?.includedActions !== includedActions) {
    setSeededFrom({ open, includedActions })
    if (open) {
      setSelectedActions(new Set(includedActions.map((a) => actionKey(a.action_name, a.action_library))))
      setSearchQuery('')
    }
  }

  // Build list of all available actions
  const availableActions = useMemo(() => {
    const actions: AvailableAction[] = []

    for (const lib of actionLibraries) {
      const libSpecs = specifications.get(lib.id) || []

      for (const spec of libSpecs) {
        actions.push({
          id: spec.id,
          name: spec.name,
          libraryName: lib.name,
          libraryId: lib.id,
        })
      }
    }

    return actions.sort((a, b) => {
      // Sort by library name, then action name
      const libCompare = a.libraryName.localeCompare(b.libraryName)
      if (libCompare !== 0) return libCompare
      return a.name.localeCompare(b.name)
    })
  }, [actionLibraries, specifications])

  // Filter actions by search query
  const filteredActions = useMemo(() => {
    if (!searchQuery) return availableActions
    const query = searchQuery.toLowerCase()
    return availableActions.filter(
      (action) => action.name.toLowerCase().includes(query) || action.libraryName.toLowerCase().includes(query),
    )
  }, [availableActions, searchQuery])

  // Group actions by library for display
  const groupedActions = useMemo(() => {
    const groups = new Map<string, AvailableAction[]>()
    for (const action of filteredActions) {
      const existing = groups.get(action.libraryName) || []
      existing.push(action)
      groups.set(action.libraryName, existing)
    }
    return groups
  }, [filteredActions])

  const toggleAction = (action: AvailableAction) => {
    const key = actionKey(action.name, action.libraryName)
    setSelectedActions((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  const handleConfirm = () => {
    const result: IncludedAction[] = []
    for (const key of selectedActions) {
      const [library, ...nameParts] = key.split('::')
      const name = nameParts.join('::') // Handle names with :: in them
      result.push({ action_name: name, action_library: library })
    }
    onConfirm(result)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Select Actions</DialogTitle>
          <DialogDescription>
            Choose actions to include in this environment. These actions will be available when editing workflows that
            use this environment.
          </DialogDescription>
        </DialogHeader>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400 dark:text-slate-500" />
          <Input
            placeholder="Search actions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8"
          />
        </div>

        {/* Action list */}
        <ScrollArea className="flex-1 min-h-[200px] max-h-[400px] border rounded-md">
          {groupedActions.size === 0 ? (
            <div className="p-4 text-center text-slate-500 dark:text-slate-400 text-sm">
              {actionLibraries.length === 0
                ? 'No action libraries found. Create an action library first.'
                : 'No actions found matching your search.'}
            </div>
          ) : (
            <div className="p-2">
              {Array.from(groupedActions.entries()).map(([libraryName, actions]) => (
                <div key={libraryName} className="mb-3">
                  <div className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide px-2 py-1">
                    {libraryName}
                  </div>
                  {actions.map((action) => {
                    const key = actionKey(action.name, action.libraryName)
                    const isSelected = selectedActions.has(key)

                    return (
                      <button
                        key={action.id}
                        onClick={() => toggleAction(action)}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left hover:bg-slate-100 dark:hover:bg-slate-800 ${
                          isSelected ? 'bg-blue-50' : ''
                        }`}
                      >
                        <div
                          className={`h-4 w-4 rounded border flex items-center justify-center ${
                            isSelected ? 'bg-blue-600 border-blue-600' : 'border-slate-300 dark:border-slate-600'
                          }`}
                        >
                          {isSelected && <Check className="h-3 w-3 text-white" />}
                        </div>
                        <Zap className="h-4 w-4 text-amber-600" />
                        <span className="flex-1 text-sm">{action.name}</span>
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        {/* Footer */}
        <DialogFooter className="flex items-center justify-between">
          <span className="text-sm text-slate-500 dark:text-slate-400">
            {selectedActions.size} action{selectedActions.size !== 1 ? 's' : ''} selected
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleConfirm}>Confirm Selection</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
