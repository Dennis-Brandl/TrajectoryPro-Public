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
import type { Block, TextInputBlock, TextareaBlock, TextInputMode, OptionEntry } from '@mission/form-schema'
import { BlockFieldNameInput } from '../shared/BlockFieldNameInput'
import { DefaultValueEditor } from '../shared/DefaultValueEditor'
import { useStepInputs } from '../shared/useStepInputs'
import { NumericInput } from '../shared/NumericInput'
import { useDebouncedField } from '../shared/useDebouncedField'
import type { ParameterSpec } from '@/types/nodes'

interface DataSectionProps {
  block: Block
  onUpdate: (patch: Partial<Block>) => void
  allBlocks: Block[]
}

const fieldStyle: React.CSSProperties = {
  marginBottom: 10,
}

const INPUT_MODE_OPTIONS: { value: TextInputMode; label: string }[] = [
  { value: 'text', label: 'Any Text' },
  { value: 'number', label: 'Number' },
  { value: 'phone', label: 'Phone Number' },
  { value: 'password', label: 'Password' },
  { value: 'dropdown', label: 'Dropdown List' },
  { value: 'combobox', label: 'Combo Box' },
]

const LIST_MODES = ['dropdown', 'combobox'] as const
type ListMode = (typeof LIST_MODES)[number]

function isListMode(mode: TextInputMode | undefined): mode is ListMode {
  return mode !== undefined && LIST_MODES.includes(mode as ListMode)
}

/**
 * Inline list-items editor for dropdown/combobox modes.
 * Simpler than an options-reorder editor (no drag reorder) since these lists are typically short.
 */
function ListItemsEditor({
  block,
  onUpdate,
  stepInputs,
}: {
  block: TextInputBlock
  onUpdate: (patch: Partial<Block>) => void
  stepInputs: ParameterSpec[]
}) {
  const listSource = block.listSource
  const sourceMode = listSource?.mode === 'input' ? 'input' : 'static'
  const items: OptionEntry[] = block.listItems ?? []
  const [newLabel, setNewLabel] = useState('')

  const handleSourceModeChange = (mode: 'static' | 'input') => {
    if (mode === 'static') {
      onUpdate({ listSource: { mode: 'static' } } as Partial<Block>)
    } else {
      onUpdate({ listSource: { mode: 'input', value: '' } } as Partial<Block>)
    }
  }

  const handleAddItem = () => {
    const trimmed = newLabel.trim()
    if (!trimmed) return
    // The value starts out as the label: steps downstream (e.g. a work-center lookup) expect the
    // text the operator saw, not a code made from it. The author can still edit it.
    const updated = [...items, { label: trimmed, value: trimmed }]
    onUpdate({ listItems: updated } as Partial<Block>)
    setNewLabel('')
  }

  const handleDeleteItem = (index: number) => {
    const updated = items.filter((_, i) => i !== index)
    onUpdate({ listItems: updated } as Partial<Block>)
  }

  const handleItemLabelChange = (index: number, label: string) => {
    const updated = items.map((item, i) => (i === index ? { ...item, label } : item))
    onUpdate({ listItems: updated } as Partial<Block>)
  }

  const handleItemValueChange = (index: number, value: string) => {
    const updated = items.map((item, i) => (i === index ? { ...item, value } : item))
    onUpdate({ listItems: updated } as Partial<Block>)
  }

  return (
    <div style={{ padding: '4px 12px 12px' }}>
      {/* List source mode toggle */}
      <div style={fieldStyle}>
        <span
          className="text-gray-500 dark:text-gray-400"
          style={{ fontSize: 11, display: 'block', marginBottom: 2, userSelect: 'none' }}
        >
          List Source
        </span>
        <select
          value={sourceMode}
          onChange={(e) => handleSourceModeChange(e.target.value as 'static' | 'input')}
          className="bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 border border-gray-300 dark:border-gray-600"
          style={{
            width: '100%',
            fontSize: 13,
            padding: '4px 8px',
            borderRadius: 4,
            boxSizing: 'border-box',
            outline: 'none',
            cursor: 'pointer',
          }}
        >
          <option value="static">Fixed Items</option>
          <option value="input">Input Parameter</option>
        </select>
      </div>

      {sourceMode === 'input' && (
        <div style={fieldStyle}>
          <span
            className="text-gray-500 dark:text-gray-400"
            style={{ fontSize: 11, display: 'block', marginBottom: 2, userSelect: 'none' }}
          >
            Input Parameter
          </span>
          <select
            value={listSource?.mode === 'input' ? listSource.value : ''}
            onChange={(e) =>
              onUpdate({
                listSource: { mode: 'input', value: e.target.value },
              } as Partial<Block>)
            }
            className="bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 border border-gray-300 dark:border-gray-600"
            style={{
              width: '100%',
              fontSize: 13,
              padding: '4px 8px',
              borderRadius: 4,
              boxSizing: 'border-box',
              outline: 'none',
              cursor: 'pointer',
            }}
          >
            <option value="">Select input parameter...</option>
            {stepInputs.map((p) => (
              <option key={p.id} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {sourceMode === 'static' && (
        <>
          {/* Column headers */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 2 }}>
            <span className="text-gray-400 dark:text-gray-500" style={{ flex: 2, fontSize: 10, userSelect: 'none' }}>
              Label
            </span>
            <span className="text-gray-400 dark:text-gray-500" style={{ flex: 1, fontSize: 10, userSelect: 'none' }}>
              Value
            </span>
            <span style={{ width: 22, flexShrink: 0 }} />
          </div>

          {/* Existing items */}
          {items.map((item, index) => (
            <div key={index} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0' }}>
              <input
                type="text"
                value={item.label}
                onChange={(e) => handleItemLabelChange(index, e.target.value)}
                className="bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 border border-gray-300 dark:border-gray-600"
                style={{ flex: 2, fontSize: 13, padding: '3px 6px', borderRadius: 4, outline: 'none', minWidth: 0 }}
                placeholder="Label"
              />
              <input
                type="text"
                value={item.value}
                onChange={(e) => handleItemValueChange(index, e.target.value)}
                className="bg-gray-50 dark:bg-slate-800 text-gray-700 dark:text-slate-300 border border-gray-300 dark:border-gray-600"
                style={{
                  flex: 1,
                  fontSize: 12,
                  fontFamily: 'monospace',
                  padding: '3px 6px',
                  borderRadius: 4,
                  outline: 'none',
                  minWidth: 0,
                }}
                placeholder="Value"
              />
              <button
                type="button"
                onClick={() => handleDeleteItem(index)}
                className="bg-white dark:bg-slate-900 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-600"
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 4,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  padding: 0,
                  fontSize: 14,
                  lineHeight: 1,
                }}
                title="Remove item"
                aria-label="Remove item"
              >
                ×
              </button>
            </div>
          ))}

          {/* Add item row */}
          <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleAddItem()
                }
              }}
              placeholder="Type and press Enter"
              className="bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 border border-gray-300 dark:border-gray-600"
              style={{ flex: 1, fontSize: 13, padding: '3px 6px', borderRadius: 4, outline: 'none', minWidth: 0 }}
            />
            <button
              type="button"
              onClick={handleAddItem}
              className="bg-white dark:bg-slate-900 text-gray-700 dark:text-slate-200 border border-gray-300 dark:border-gray-600"
              style={{ fontSize: 12, padding: '3px 8px', borderRadius: 4, cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              Add
            </button>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Data section for data-collecting blocks: textInput, textarea, checkbox, radio.
 * Shows fieldName (with uniqueness validation), required toggle, label, placeholder,
 * and (for textarea) rows.
 *
 * Placeholder supports two modes:
 * - Static text (default): plain text placeholder string
 * - Value Property: sources placeholder from a Value Property reference at runtime
 */
export function DataSection({ block, onUpdate, allBlocks }: DataSectionProps) {
  const stepInputs = useStepInputs()

  const isTextInput = block.type === 'textInput'
  const inputMode: TextInputMode = isTextInput ? ((block as TextInputBlock).inputMode ?? 'text') : 'text'
  const showListEditor = isTextInput && isListMode(inputMode)

  const hasPlaceholder = (block.type === 'textInput' || block.type === 'textarea') && !isListMode(inputMode)
  const hasDefault = block.type === 'textInput' || block.type === 'textarea'
  const hasRows = block.type === 'textarea'
  const hasLabel =
    block.type === 'textInput' || block.type === 'textarea' || block.type === 'checkbox' || block.type === 'radio'

  const fieldName = 'fieldName' in block ? (block as { fieldName: string }).fieldName : ''
  const rawLabel = 'label' in block ? ((block as { label?: string }).label ?? '') : ''
  const rawPlaceholder =
    hasPlaceholder && 'placeholder' in block ? ((block as TextInputBlock | TextareaBlock).placeholder ?? '') : ''

  // Debounced text fields — updates fire 300ms after user stops typing
  const [label, onLabelChange] = useDebouncedField(block.id, rawLabel, onUpdate, 'label')
  const [placeholder, onPlaceholderChange] = useDebouncedField(block.id, rawPlaceholder, onUpdate, 'placeholder')
  const required = 'required' in block ? !!(block as { required?: boolean }).required : false
  const rows = hasRows ? ((block as TextareaBlock).rows ?? 4) : 4

  // Placeholder mode: 'text' for static, 'input' for step input parameter
  const placeholderSource = hasPlaceholder ? (block as TextInputBlock | TextareaBlock).placeholderSource : undefined
  const [phMode, setPhMode] = useState<'text' | 'input'>(placeholderSource?.mode === 'input' ? 'input' : 'text')
  const [phSynced, setPhSynced] = useState<{ id: string; has: boolean; mode: string | undefined }>({
    id: block.id,
    has: hasPlaceholder,
    mode: placeholderSource?.mode,
  })

  // Sync the placeholder mode when the block changes or its placeholderSource.mode changes
  // externally — during render, matching the debounced fields above.
  if (phSynced.id !== block.id || phSynced.has !== hasPlaceholder || phSynced.mode !== placeholderSource?.mode) {
    setPhSynced({ id: block.id, has: hasPlaceholder, mode: placeholderSource?.mode })
    setPhMode(hasPlaceholder && placeholderSource?.mode === 'input' ? 'input' : 'text')
  }

  const handlePhModeChange = (newMode: 'text' | 'input') => {
    setPhMode(newMode)
    if (newMode === 'text') {
      // Clear placeholderSource, keep existing static placeholder
      onUpdate({ placeholderSource: undefined } as Partial<Block>)
    } else {
      onUpdate({
        placeholder: '',
        placeholderSource: { mode: 'input', value: '' },
      } as Partial<Block>)
    }
  }

  const handleInputModeChange = (mode: TextInputMode) => {
    const updates: Partial<TextInputBlock> = { inputMode: mode }
    // When switching away from list modes, clear list-specific data
    if (!isListMode(mode)) {
      updates.listItems = undefined
      updates.listSource = undefined
    }
    // When switching to list mode, initialize with empty static list if not already set
    if (isListMode(mode) && !isListMode(inputMode)) {
      updates.listItems = []
      updates.listSource = { mode: 'static' }
      // Clear placeholder since dropdown/combobox don't use it the same way
      updates.placeholder = ''
      updates.placeholderSource = undefined
    }
    onUpdate(updates as Partial<Block>)
  }

  return (
    <div style={{ padding: '4px 12px 12px' }}>
      {/* Field Name */}
      <div style={fieldStyle}>
        <BlockFieldNameInput value={fieldName} blockId={block.id} allBlocks={allBlocks} onUpdate={onUpdate} />
      </div>

      {/* Input Mode — textInput only */}
      {isTextInput && (
        <div style={fieldStyle}>
          <span
            className="text-gray-500 dark:text-gray-400"
            style={{ fontSize: 11, display: 'block', marginBottom: 2, userSelect: 'none' }}
          >
            Input Mode
          </span>
          <select
            value={inputMode}
            onChange={(e) => handleInputModeChange(e.target.value as TextInputMode)}
            className="bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 border border-gray-300 dark:border-gray-600"
            style={{
              width: '100%',
              fontSize: 13,
              padding: '4px 8px',
              borderRadius: 4,
              boxSizing: 'border-box',
              outline: 'none',
              cursor: 'pointer',
            }}
          >
            {INPUT_MODE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Required toggle */}
      <div style={fieldStyle}>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={required}
            onChange={() => onUpdate({ required: !required } as Partial<Block>)}
            style={{ cursor: 'pointer' }}
          />
          <span className="text-gray-700 dark:text-slate-200" style={{ fontSize: 13 }}>
            Required
          </span>
        </label>
      </div>

      {/* Label */}
      {hasLabel && (
        <div style={fieldStyle}>
          <span
            className="text-gray-500 dark:text-gray-400"
            style={{ fontSize: 11, display: 'block', marginBottom: 2, userSelect: 'none' }}
          >
            Label
          </span>
          <input
            type="text"
            value={label}
            onChange={(e) => onLabelChange(e.target.value)}
            className="bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 border border-gray-300 dark:border-gray-600"
            style={{
              width: '100%',
              fontSize: 13,
              padding: '4px 8px',
              borderRadius: 4,
              boxSizing: 'border-box',
              outline: 'none',
            }}
            placeholder="Label text..."
          />
        </div>
      )}

      {/* Default Value — textInput/textarea only */}
      {hasDefault && (
        <DefaultValueEditor
          source={(block as TextInputBlock | TextareaBlock).defaultSource}
          stepInputs={stepInputs}
          onChange={(next) => onUpdate({ defaultSource: next } as Partial<Block>)}
        />
      )}

      {/* Placeholder with mode toggle — hidden for dropdown/combobox */}
      {hasPlaceholder && (
        <>
          <div style={fieldStyle}>
            <span
              className="text-gray-500 dark:text-gray-400"
              style={{ fontSize: 11, display: 'block', marginBottom: 2, userSelect: 'none' }}
            >
              Placeholder or Source
            </span>
            <select
              value={phMode}
              onChange={(e) => handlePhModeChange(e.target.value as 'text' | 'input')}
              className="bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 border border-gray-300 dark:border-gray-600"
              style={{
                width: '100%',
                fontSize: 13,
                padding: '4px 8px',
                borderRadius: 4,
                boxSizing: 'border-box',
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              <option value="text">Placeholder text</option>
              <option value="input">Input Parameter</option>
            </select>
          </div>

          {phMode === 'text' && (
            <div style={fieldStyle}>
              <span
                className="text-gray-500 dark:text-gray-400"
                style={{ fontSize: 11, display: 'block', marginBottom: 2, userSelect: 'none' }}
              >
                Placeholder Text
              </span>
              <input
                type="text"
                value={placeholder}
                onChange={(e) => onPlaceholderChange(e.target.value)}
                className="bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 border border-gray-300 dark:border-gray-600"
                style={{
                  width: '100%',
                  fontSize: 13,
                  padding: '4px 8px',
                  borderRadius: 4,
                  boxSizing: 'border-box',
                  outline: 'none',
                }}
                placeholder="Placeholder text..."
              />
            </div>
          )}

          {phMode === 'input' && (
            <div style={fieldStyle}>
              <span
                className="text-gray-500 dark:text-gray-400"
                style={{ fontSize: 11, display: 'block', marginBottom: 2, userSelect: 'none' }}
              >
                Input Parameter
              </span>
              <select
                value={placeholderSource?.mode === 'input' ? placeholderSource.value : ''}
                onChange={(e) =>
                  onUpdate({
                    placeholderSource: { mode: 'input', value: e.target.value },
                  } as Partial<Block>)
                }
                className="bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 border border-gray-300 dark:border-gray-600"
                style={{
                  width: '100%',
                  fontSize: 13,
                  padding: '4px 8px',
                  borderRadius: 4,
                  boxSizing: 'border-box',
                  outline: 'none',
                  cursor: 'pointer',
                }}
              >
                <option value="">Select input parameter...</option>
                {stepInputs.map((p) => (
                  <option key={p.id} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </>
      )}

      {/* List items editor — dropdown/combobox only */}
      {showListEditor && (
        <ListItemsEditor block={block as TextInputBlock} onUpdate={onUpdate} stepInputs={stepInputs} />
      )}

      {/* Rows (textarea only) */}
      {hasRows && (
        <div style={fieldStyle}>
          <NumericInput
            label="Rows"
            value={rows}
            onChange={(v) => onUpdate({ rows: v } as Partial<Block>)}
            min={1}
            max={20}
            step={1}
          />
        </div>
      )}
    </div>
  )
}
