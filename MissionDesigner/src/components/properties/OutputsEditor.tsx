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
import { Plus, Trash2 } from 'lucide-react'
import { OutputParameterSelect } from './OutputParameterSelect'
import type { ParameterSpec } from '@/types/nodes'
import { generateOID, WORKER_INTERNAL } from '@/lib/snowflake'

interface OutputsEditorProps {
  outputs: ParameterSpec[]
  onChange: (outputs: ParameterSpec[]) => void
  /** When true, disables add/remove and makes outputs read-only */
  readOnly?: boolean
  /** When true, only shows name (hides target selector and description) */
  nameOnly?: boolean
  /** When true, hides the internal "Output Parameters" title (accordion supplies it) */
  hideHeading?: boolean
}

function OutputsEditorComponent({
  outputs,
  onChange,
  readOnly = false,
  nameOnly = false,
  hideHeading = false,
}: OutputsEditorProps) {
  const addOutput = useCallback(() => {
    onChange([...outputs, { id: generateOID(WORKER_INTERNAL), name: '', description: '' }])
  }, [outputs, onChange])

  const updateOutput = useCallback(
    (id: string, updates: Partial<ParameterSpec>) => {
      onChange(outputs.map((output) => (output.id === id ? { ...output, ...updates } : output)))
    },
    [outputs, onChange],
  )

  const removeOutput = useCallback(
    (id: string) => {
      onChange(outputs.filter((output) => output.id !== id))
    },
    [outputs, onChange],
  )

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        {!hideHeading && <Label className="text-xs font-medium">Output Parameters</Label>}
        {!readOnly && !nameOnly && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={addOutput}
            aria-label="Add output parameter"
          >
            <Plus className="h-3 w-3" />
          </Button>
        )}
      </div>

      {outputs.length === 0 && <p className="text-xs text-slate-500 dark:text-slate-400 italic">No outputs defined</p>}

      {outputs.map((output) => (
        <div key={output.id} className="flex gap-1 items-start">
          <div className="flex-1 space-y-0.5">
            <Input
              placeholder="Parameter name"
              value={output.name}
              onChange={(e) => updateOutput(output.id, { name: e.target.value.replace(/\s/g, '') })}
              className="h-7 text-sm"
              disabled={readOnly}
            />
            {!nameOnly && (
              <>
                <OutputParameterSelect
                  value={output.target || undefined}
                  onChange={(target) => updateOutput(output.id, { target })}
                />
                <Input
                  placeholder="Description (optional)"
                  value={output.description || ''}
                  onChange={(e) => updateOutput(output.id, { description: e.target.value })}
                  className="h-7 text-xs text-slate-500 dark:text-slate-400"
                  disabled={readOnly}
                />
              </>
            )}
          </div>
          {!readOnly && !nameOnly && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => removeOutput(output.id)}
              className="h-6 w-6 p-0 text-red-500 hover:text-red-700"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      ))}
    </div>
  )
}

export const OutputsEditor = memo(OutputsEditorComponent)
