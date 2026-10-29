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
import { Zap, Plus, X } from 'lucide-react'
import { Label } from '@mission/ui'
import { Button } from '@mission/ui'
import { ActionPickerDialog } from './ActionPickerDialog'

interface IncludedAction {
  action_name: string
  action_library: string
}

interface IncludedActionsEditorProps {
  /** List of included actions */
  actions: IncludedAction[]
  /** Callback when actions change */
  onChange: (actions: IncludedAction[]) => void
  /** Whether the editor is read-only */
  readOnly?: boolean
}

/**
 * Editor component for managing the list of actions included in an environment.
 * Shows each action with its library and allows adding/removing via a picker dialog.
 */
export function IncludedActionsEditor({ actions, onChange, readOnly = false }: IncludedActionsEditorProps) {
  const [showPicker, setShowPicker] = useState(false)

  const handleRemove = (index: number) => {
    const newActions = [...actions]
    newActions.splice(index, 1)
    onChange(newActions)
  }

  const handlePickerConfirm = (selectedActions: IncludedAction[]) => {
    onChange(selectedActions)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">Included Actions</Label>
        {!readOnly && (
          <Button variant="ghost" size="sm" onClick={() => setShowPicker(true)} className="h-6 px-2 text-xs">
            <Plus className="h-3 w-3 mr-1" />
            Add Actions
          </Button>
        )}
      </div>

      {actions.length === 0 ? (
        <p className="text-xs text-slate-400 dark:text-slate-500 italic py-2">
          No actions included. Click "Add Actions" to select actions from your action libraries.
        </p>
      ) : (
        <div className="space-y-1">
          {actions.map((action, index) => (
            <div
              key={`${action.action_library}::${action.action_name}`}
              className="flex items-center gap-2 px-2 py-1.5 bg-slate-50 dark:bg-slate-800 rounded-md group"
            >
              <Zap className="h-3.5 w-3.5 text-amber-600 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-sm truncate block">{action.action_name}</span>
                <span className="text-xs text-slate-400 dark:text-slate-500 truncate block">
                  {action.action_library}
                </span>
              </div>
              {!readOnly && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRemove(index)}
                  className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100"
                >
                  <X className="h-3 w-3 text-slate-400 dark:text-slate-500 hover:text-red-500" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Action Picker Dialog */}
      <ActionPickerDialog
        open={showPicker}
        onOpenChange={setShowPicker}
        includedActions={actions}
        onConfirm={handlePickerConfirm}
      />
    </div>
  )
}
