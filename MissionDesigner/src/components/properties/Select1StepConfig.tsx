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
import { Input } from '@mission/ui'
import { Label } from '@mission/ui'
import { Button } from '@mission/ui'
import { ReorderableList } from '@/components/properties/ReorderableList'
import { ValuePropertyInput } from '@/components/properties/ValuePropertyInput'
import type { ExtraPickerGroup } from '@/components/properties/ValuePropertyInput'
import { useFlowStore } from '@/stores/flowStore'
import type { StepNodeData, Select1OptionSpec, Select1Operator } from '@/types/nodes'
import { generateOID, WORKER_INTERNAL } from '@/lib/snowflake'
import { useSourcePickerExtraGroups } from '@/hooks/useSourcePickerExtraGroups'

const OPERATORS: { value: Select1Operator; label: string }[] = [
  { value: '==', label: '=' },
  { value: '!=', label: '≠' },
  { value: '<', label: '<' },
  { value: '>', label: '>' },
  { value: '<=', label: '≤' },
  { value: '>=', label: '≥' },
  { value: 'Contains', label: '∋' },
  { value: 'Not Contains', label: '∌' },
]

interface Select1StepConfigProps {
  data: StepNodeData
  nodeId: string
  onChange: (updates: Partial<StepNodeData>) => void
  readOnly?: boolean
}

function Select1OptionEditor({
  option,
  onUpdate,
  onSetDefault,
  readOnly,
  extraGroups,
}: {
  option: Select1OptionSpec
  onUpdate: (id: string, updates: Partial<Select1OptionSpec>) => void
  onSetDefault: (id: string) => void
  readOnly: boolean
  extraGroups?: ExtraPickerGroup[]
}) {
  return (
    <div className="space-y-1.5 border-l-2 border-slate-200 dark:border-slate-700 pl-2">
      <div className="flex items-center gap-2">
        <input
          type="radio"
          checked={option.isDefault}
          onChange={() => onSetDefault(option.id)}
          disabled={readOnly}
          className="h-3 w-3 accent-amber-600"
          title="Set as default (no condition check)"
        />
        <Input
          value={option.label}
          onChange={(e) => onUpdate(option.id, { label: e.target.value })}
          placeholder="Connection label..."
          className="h-7 text-sm flex-1"
          disabled={readOnly}
        />
      </div>
      <div className="flex items-center gap-1 pl-5">
        <select
          value={option.operator}
          onChange={(e) => onUpdate(option.id, { operator: e.target.value as Select1Operator })}
          disabled={readOnly || option.isDefault}
          className="h-7 text-sm border border-slate-300 dark:border-slate-600 rounded px-1 bg-white dark:bg-slate-900 disabled:opacity-50"
        >
          {OPERATORS.map((op) => (
            <option key={op.value} value={op.value}>
              {op.label} {op.value}
            </option>
          ))}
        </select>
        <div className="flex-1 flex items-center gap-1">
          {option.valueType === 'property' ? (
            <ValuePropertyInput
              value={option.value}
              onChange={(v) => onUpdate(option.id, { value: v })}
              placeholder="Select property..."
              readOnly={readOnly || option.isDefault}
              className="h-7 text-sm flex-1"
              extraGroups={extraGroups}
            />
          ) : (
            <Input
              value={option.value}
              onChange={(e) => onUpdate(option.id, { value: e.target.value })}
              placeholder="Comparison value..."
              className="h-7 text-sm flex-1"
              disabled={readOnly || option.isDefault}
            />
          )}
          <Button
            variant="ghost"
            size="sm"
            className={`h-7 px-1.5 text-[10px] font-mono ${option.valueType === 'property' ? 'bg-blue-100 text-blue-700' : 'text-slate-500 dark:text-slate-400'}`}
            onClick={() => onUpdate(option.id, { valueType: option.valueType === 'literal' ? 'property' : 'literal' })}
            disabled={readOnly || option.isDefault}
            title={
              option.valueType === 'property'
                ? 'Value property reference (click to switch to literal)'
                : 'Literal value (click to switch to property ref)'
            }
          >
            {option.valueType === 'property' ? 'P' : 'L'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function Select1StepConfigComponent({ data, nodeId, onChange, readOnly = false }: Select1StepConfigProps) {
  const sourceExtraGroups = useSourcePickerExtraGroups(nodeId)
  const compareExtraGroups = useSourcePickerExtraGroups(nodeId, { includeOwnInputs: true })

  const handleOptionsChange = useCallback(
    (options: Select1OptionSpec[]) => {
      // Sync edges: remove any edges whose sourceHandle no longer matches an option ID
      const edges = useFlowStore.getState().edges
      const optionIds = new Set(options.map((o) => o.id))
      const updatedEdges = edges.filter((e) => {
        if (e.source !== nodeId) return true
        if (!e.sourceHandle) return true
        return optionIds.has(e.sourceHandle)
      })
      if (updatedEdges.length !== edges.length) {
        useFlowStore.getState().setEdges(updatedEdges)
      }
      onChange({ select1Options: options })
    },
    [onChange, nodeId],
  )

  const handleSetDefault = useCallback(
    (optionId: string) => {
      const options = (data.select1Options || []) as Select1OptionSpec[]
      // Toggle: if already default, unset; otherwise set this one and clear others
      const isAlreadyDefault = options.find((o) => o.id === optionId)?.isDefault
      const updated = options.map((o) => ({
        ...o,
        isDefault: isAlreadyDefault ? false : o.id === optionId,
      }))
      onChange({ select1Options: updated })
    },
    [data.select1Options, onChange],
  )

  const createOption = useCallback(
    (): Select1OptionSpec => ({
      id: generateOID(WORKER_INTERNAL),
      label: '',
      operator: '==',
      value: '',
      valueType: 'literal',
      isDefault: false,
    }),
    [],
  )

  const renderOption = useCallback(
    (
      option: Select1OptionSpec,
      updateItem: (id: string, updates: Partial<Select1OptionSpec>) => void,
      isReadOnly: boolean,
    ) => (
      <Select1OptionEditor
        option={option}
        onUpdate={updateItem}
        onSetDefault={handleSetDefault}
        readOnly={isReadOnly}
        extraGroups={sourceExtraGroups}
      />
    ),
    [handleSetDefault, sourceExtraGroups],
  )

  const options = (data.select1Options || []) as Select1OptionSpec[]

  return (
    <div className="space-y-4 border-t border-slate-200 dark:border-slate-700 pt-3">
      <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wide">
        Select 1 Configuration
      </span>

      {/* Input Parameter Name */}
      <div className="space-y-1">
        <Label className="text-xs text-slate-500 dark:text-slate-400">Input Parameter Name</Label>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 cursor-pointer shrink-0">
            <input
              type="radio"
              name="select1InputValueType"
              checked={data.select1InputValueType !== 'property'}
              onChange={() => onChange({ select1InputValueType: 'literal' })}
              className="h-3 w-3 accent-slate-600 dark:accent-slate-300"
              disabled={readOnly}
            />
            <span className="text-xs text-slate-600 dark:text-slate-300">Text</span>
          </label>
          <label className="flex items-center gap-1 cursor-pointer shrink-0">
            <input
              type="radio"
              name="select1InputValueType"
              checked={data.select1InputValueType === 'property'}
              onChange={() => onChange({ select1InputValueType: 'property' })}
              className="h-3 w-3 accent-slate-600 dark:accent-slate-300"
              disabled={readOnly}
            />
            <span className="text-xs text-slate-600 dark:text-slate-300">Source</span>
          </label>
        </div>
        {data.select1InputValueType === 'property' ? (
          <ValuePropertyInput
            value={data.select1InputName || ''}
            onChange={(value) => onChange({ select1InputName: value })}
            placeholder="Select value property..."
            readOnly={readOnly}
            className="w-full"
            extraGroups={compareExtraGroups}
          />
        ) : (
          <Input
            value={data.select1InputName || ''}
            onChange={(e) => onChange({ select1InputName: e.target.value })}
            placeholder="Parameter to compare..."
            className="h-7 text-sm"
            disabled={readOnly}
          />
        )}
      </div>

      {/* Comparison Options */}
      <ReorderableList
        title="Comparison Options"
        items={options}
        onChange={handleOptionsChange}
        renderItem={renderOption}
        readOnly={readOnly}
        createItem={createOption}
        emptyMessage="No options defined. Click + to add."
      />
    </div>
  )
}

export const Select1StepConfig = memo(Select1StepConfigComponent)
