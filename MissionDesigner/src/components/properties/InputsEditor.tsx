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
import { ValuePropertyInput } from './ValuePropertyInput'
import type { ParameterSpec } from '@/types/nodes'
import { generateOID, WORKER_INTERNAL } from '@/lib/snowflake'
import { useSourcePickerExtraGroups } from '@/hooks/useSourcePickerExtraGroups'

/** Parameter names travel as {{Name}} tokens in text-block content and as HTML-attribute
 *  values in the content editor's chips, so beyond whitespace they must never contain the
 *  token braces (they can't round-trip through the token regex at all) or the HTML-special
 *  characters `& " < >` (entity-encoding hazards at every serialization boundary) —
 *  deferred final-review ticket from the 2026-08-11 WYSIWYG feature. */
function sanitizeParamName(raw: string): string {
  return raw.replace(/[\s{}&"<>]/g, '')
}

interface InputsEditorProps {
  inputs: ParameterSpec[]
  onChange: (inputs: ParameterSpec[]) => void
  /** When true, disables add/remove and makes inputs read-only */
  readOnly?: boolean
  /** When true, only shows name + description (hides value/valueType/source controls) */
  nameOnly?: boolean
  /** Current node ID — used to gather output parameters from other steps */
  nodeId?: string
  /** When true, hides the internal "Input Parameters" title (accordion supplies it) */
  hideHeading?: boolean
  /** Spec 2026-09-04 §5.2.3: offer environment Action Properties in the Source picker. */
  includeActionProperties?: boolean
}

function InputsEditorComponent({
  inputs,
  onChange,
  readOnly = false,
  nameOnly = false,
  nodeId,
  hideHeading = false,
  includeActionProperties = false,
}: InputsEditorProps) {
  const sourceExtraGroups = useSourcePickerExtraGroups(nodeId)

  const addInput = useCallback(() => {
    onChange([...inputs, { id: generateOID(WORKER_INTERNAL), name: '', description: '' }])
  }, [inputs, onChange])

  const updateInput = useCallback(
    (id: string, updates: Partial<ParameterSpec>) => {
      onChange(inputs.map((input) => (input.id === id ? { ...input, ...updates } : input)))
    },
    [inputs, onChange],
  )

  const removeInput = useCallback(
    (id: string) => {
      onChange(inputs.filter((input) => input.id !== id))
    },
    [inputs, onChange],
  )

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        {!hideHeading && <Label className="text-xs font-medium">Input Parameters</Label>}
        {!readOnly && !nameOnly && (
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={addInput} aria-label="Add input parameter">
            <Plus className="h-3 w-3" />
          </Button>
        )}
      </div>

      {inputs.length === 0 && <p className="text-xs text-slate-500 dark:text-slate-400 italic">No inputs defined</p>}

      {inputs.map((input) => {
        const isProperty = input.valueType === 'property'
        return (
          <div key={input.id} className="flex gap-1 items-start">
            <div className="flex-1 space-y-0.5">
              {nameOnly ? (
                <Input
                  placeholder="Name"
                  value={input.name}
                  onChange={(e) => updateInput(input.id, { name: sanitizeParamName(e.target.value) })}
                  className="h-7 text-sm"
                  disabled={readOnly}
                />
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder="Name"
                      value={input.name}
                      onChange={(e) => updateInput(input.id, { name: sanitizeParamName(e.target.value) })}
                      className="h-7 text-sm flex-1 min-w-0"
                      disabled={readOnly}
                    />
                    <label className="flex items-center gap-1 cursor-pointer shrink-0">
                      <input
                        type="radio"
                        name={`valueType-${input.id}`}
                        checked={!isProperty}
                        onChange={() => updateInput(input.id, { valueType: 'literal' })}
                        className="h-3 w-3 accent-slate-600 dark:accent-slate-300"
                      />
                      <span className="text-xs text-slate-600 dark:text-slate-300">Text</span>
                    </label>
                    <label className="flex items-center gap-1 cursor-pointer shrink-0">
                      <input
                        type="radio"
                        name={`valueType-${input.id}`}
                        checked={isProperty}
                        onChange={() => updateInput(input.id, { valueType: 'property' })}
                        className="h-3 w-3 accent-slate-600 dark:accent-slate-300"
                      />
                      <span className="text-xs text-slate-600 dark:text-slate-300">Source</span>
                    </label>
                  </div>
                  {isProperty ? (
                    <ValuePropertyInput
                      value={input.value || ''}
                      onChange={(value) => updateInput(input.id, { value })}
                      placeholder="Select workflow or property source..."
                      className="w-full"
                      extraGroups={sourceExtraGroups}
                      includeActionProperties={includeActionProperties}
                    />
                  ) : (
                    <Input
                      placeholder="Value"
                      value={input.value || ''}
                      onChange={(e) => updateInput(input.id, { value: e.target.value })}
                      className="h-7 text-sm"
                    />
                  )}
                  <Input
                    placeholder="Description (optional)"
                    value={input.description || ''}
                    onChange={(e) => updateInput(input.id, { description: e.target.value })}
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
                onClick={() => removeInput(input.id)}
                className="h-6 w-6 p-0 text-red-500 hover:text-red-700"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </div>
        )
      })}
    </div>
  )
}

export const InputsEditor = memo(InputsEditorComponent)
