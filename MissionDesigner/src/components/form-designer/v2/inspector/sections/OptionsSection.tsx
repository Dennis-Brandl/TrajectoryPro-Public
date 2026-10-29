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

import { useState, useMemo, useCallback } from 'react'
import { GripVertical, X } from 'lucide-react'
import { toast } from 'sonner'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { KeyboardSensor } from '@dnd-kit/core'
import type { Block, CheckboxBlock, RadioBlock, OptionEntry } from '@mission/form-schema'
import { useFormDocumentStore } from '@/stores/formDocumentStore'
import { DeviceSizeField } from '../shared/DeviceSizeField'
import { useFlowStore } from '@/stores/flowStore'
import type { ParameterSpec } from '@/types/nodes'

interface OptionItem {
  id: string
  label: string
  value: string
}

interface SortableOptionRowProps {
  item: OptionItem
  onLabelChange: (id: string, label: string) => void
  onValueChange: (id: string, value: string) => void
  onDelete: (id: string) => void
}

/** Individual draggable option row with grip handle, label input, value input, and delete button */
function SortableOptionRow({ item, onLabelChange, onValueChange, onDelete }: SortableOptionRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 0',
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      {/* Grip handle -- only this element gets drag listeners */}
      <span
        {...listeners}
        className="text-gray-400 dark:text-gray-500"
        style={{ cursor: 'grab', display: 'flex', alignItems: 'center', flexShrink: 0 }}
        aria-label="Drag to reorder"
      >
        <GripVertical size={14} />
      </span>

      {/* Label input */}
      <input
        type="text"
        value={item.label}
        onChange={(e) => onLabelChange(item.id, e.target.value)}
        className="bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 border border-gray-300 dark:border-gray-600"
        style={{
          flex: 2,
          fontSize: 13,
          padding: '3px 6px',
          borderRadius: 4,
          outline: 'none',
          minWidth: 0,
        }}
        placeholder="Label"
      />

      {/* Value input */}
      <input
        type="text"
        value={item.value}
        onChange={(e) => onValueChange(item.id, e.target.value)}
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

      {/* Delete button */}
      <button
        type="button"
        onClick={() => onDelete(item.id)}
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
        }}
        title="Remove option"
        aria-label="Remove option"
      >
        <X size={12} />
      </button>
    </div>
  )
}

interface OptionsSectionProps {
  block: Block
  onUpdate: (patch: Partial<Block>) => void
}

/** Counter for stable option IDs within a session */
let idCounter = 0

function makeId() {
  return `opt-${++idCounter}`
}

function deriveItems(options: OptionEntry[]): OptionItem[] {
  return options.map((opt) => {
    // Defensive: handle legacy string[] options that haven't been migrated yet
    if (typeof opt === 'string') return { id: makeId(), label: opt, value: opt }
    return { id: makeId(), label: opt.label, value: opt.value }
  })
}

// v1 used a raw pixel `fontSize: number`; the v2 schema instead carries the
// design-token `size?: TypeToken` (same convention as AppearanceSection.tsx).
// The renderer (CheckboxBlockView/RadioBlockView) falls back to 'sm' when unset.

/**
 * Options section for checkbox and radio blocks.
 * Provides add-via-Enter, remove-via-X, and drag-to-reorder.
 * Uses local state with stable IDs; commits OptionEntry[] to the store on change.
 *
 * The list source can be either 'static' (items come from `options`) or 'input'
 * (items come from a step input parameter at runtime). When 'input' is selected
 * the static editor is hidden and a parameter picker is shown instead — the
 * existing `options` array is preserved and rendered as designer-only example
 * items so the author can size the group.
 */
export function OptionsSection({ block: blockProp, onUpdate }: OptionsSectionProps) {
  // renderSections only mounts this section for checkbox/radio blocks; narrow once here
  // so the rest of the (ported, v1-shaped) body can read `block.options` etc. directly.
  const block = blockProp as CheckboxBlock | RadioBlock
  const [localOptions, setLocalOptions] = useState<OptionItem[]>(() => deriveItems(block.options))
  const [newLabel, setNewLabel] = useState('')
  // Track the block ID + options signature to detect external changes (block switch, undo/redo)
  // vs. our own local commits — held as state so the render-time re-derive guard below can read
  // it without touching a ref during render.
  const [synced, setSynced] = useState({ id: block.id, options: JSON.stringify(block.options) })

  // Step input parameters available for the 'input' list-source mode
  const openNodeId = useFormDocumentStore((s) => s.openNodeId)
  const nodes = useFlowStore((s) => s.nodes)
  const stepInputs: ParameterSpec[] = useMemo(() => {
    if (!openNodeId) return []
    const node = nodes.find((n) => n.id === openNodeId)
    return ((node?.data as { inputs?: ParameterSpec[] })?.inputs || []).filter((p) => p.name)
  }, [openNodeId, nodes])

  const sourceMode: 'static' | 'input' = block.listSource?.mode === 'input' ? 'input' : 'static'
  const inputParamName = block.listSource?.mode === 'input' ? block.listSource.value : ''
  const groupKind = block.type === 'radio' ? 'radio button group' : 'checkbox group'

  const handleSourceModeChange = (mode: 'static' | 'input') => {
    if (mode === sourceMode) return
    if (mode === 'static') {
      onUpdate({ listSource: { mode: 'static' } } as Partial<Block>)
    } else {
      onUpdate({ listSource: { mode: 'input', value: '' } } as Partial<Block>)
      toast.warning(
        `Make sure the ${groupKind} is tall enough to fit the items provided by the input parameter at runtime.`,
        { duration: 6000 },
      )
    }
  }

  // When the block changes (different block selected) or its options change externally
  // (e.g. undo/redo), re-derive local state during render. The ref guard is updated before
  // the setState so this settles in one extra render with no effect and no paint of stale
  // items — React's "adjust state during render" pattern.
  const optionsStr = JSON.stringify(block.options)
  if (synced.id !== block.id || synced.options !== optionsStr) {
    setSynced({ id: block.id, options: optionsStr })
    setLocalOptions(deriveItems(block.options))
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const commitToStore = useCallback(
    (items: OptionItem[]) => {
      const options = items.map((o) => ({ label: o.label, value: o.value }))
      // Suppress the re-derive guard from clobbering this local edit on the next render.
      setSynced((s) => ({ ...s, options: JSON.stringify(options) }))
      onUpdate({ options } as Partial<Block>)
    },
    [onUpdate],
  )

  // Each handler computes the next options from the CURRENT localOptions (closure) and then
  // calls setLocalOptions + commitToStore as sibling statements in the event handler — NOT
  // commitToStore inside a setLocalOptions updater. That ordering is load-bearing: React 18
  // batches setLocalOptions, setSynced (inside commitToStore), and the zustand onUpdate into a
  // single re-render, so `synced.options` and `block.options` update together and the render-time
  // re-derive guard never fires on our own edit. Calling commitToStore inside the updater ran
  // those side effects during the reducer phase, letting the store-driven re-render observe a
  // stale `synced`, fire the guard, and re-derive `localOptions` with fresh ids — which remounted
  // the option inputs mid-keystroke and dropped focus (typing "Green" showed "Gr", then "hung").
  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = localOptions.findIndex((o) => o.id === active.id)
    const newIndex = localOptions.findIndex((o) => o.id === over.id)
    const reordered = arrayMove(localOptions, oldIndex, newIndex)
    setLocalOptions(reordered)
    commitToStore(reordered)
  }

  function handleLabelChange(id: string, label: string) {
    const updated = localOptions.map((o) => (o.id === id ? { ...o, label } : o))
    setLocalOptions(updated)
    commitToStore(updated)
  }

  function handleValueChange(id: string, value: string) {
    const updated = localOptions.map((o) => (o.id === id ? { ...o, value } : o))
    setLocalOptions(updated)
    commitToStore(updated)
  }

  function handleDelete(id: string) {
    const updated = localOptions.filter((o) => o.id !== id)
    setLocalOptions(updated)
    commitToStore(updated)
  }

  function handleAddOption() {
    const trimmed = newLabel.trim()
    if (!trimmed) return
    // The value starts out as the label (see DataSection's list items); the author can edit it.
    const newItem: OptionItem = { id: makeId(), label: trimmed, value: trimmed }
    const updated = [...localOptions, newItem]
    setLocalOptions(updated)
    commitToStore(updated)
    setNewLabel('')
  }

  function handleAddKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAddOption()
    }
  }

  return (
    <div style={{ padding: '4px 12px 12px' }}>
      {/* Size */}
      <DeviceSizeField
        size={block.size}
        sizeAt={block.sizeAt}
        fallback="sm"
        onChange={(patch) => onUpdate(patch as Partial<Block>)}
      />

      {/* List Source toggle */}
      <div style={{ marginBottom: 12 }}>
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

      {/* Input Parameter picker — shown in 'input' source mode */}
      {sourceMode === 'input' && (
        <>
          <div style={{ marginBottom: 12 }}>
            <span
              className="text-gray-500 dark:text-gray-400"
              style={{ fontSize: 11, display: 'block', marginBottom: 2, userSelect: 'none' }}
            >
              Input Parameter
            </span>
            <select
              value={inputParamName}
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
          <div
            className="bg-amber-50 dark:bg-[#3a2a08] border border-amber-200 dark:border-amber-700 text-amber-800 dark:text-amber-300"
            style={{ borderRadius: 6, padding: '6px 10px', fontSize: 11, lineHeight: 1.4, marginBottom: 8 }}
          >
            Items below are example layouts only — the runtime list comes from the selected input parameter. Make sure
            the group is tall enough for the expected number of items.
          </div>
        </>
      )}

      {/* Static editor — drag-reorder list (used in 'static' mode and as
          designer-only example items in 'input' mode). */}
      <div style={{ display: 'flex', gap: 6, paddingLeft: 26, marginBottom: 2 }}>
        <span className="text-gray-400 dark:text-gray-500" style={{ flex: 2, fontSize: 10, userSelect: 'none' }}>
          Label
        </span>
        <span className="text-gray-400 dark:text-gray-500" style={{ flex: 1, fontSize: 10, userSelect: 'none' }}>
          Value
        </span>
        <span style={{ width: 22, flexShrink: 0 }} />
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={localOptions.map((o) => o.id)} strategy={verticalListSortingStrategy}>
          {localOptions.map((item) => (
            <SortableOptionRow
              key={item.id}
              item={item}
              onLabelChange={handleLabelChange}
              onValueChange={handleValueChange}
              onDelete={handleDelete}
            />
          ))}
        </SortableContext>
      </DndContext>

      {/* Add option row */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          marginTop: 8,
          alignItems: 'center',
        }}
      >
        <input
          type="text"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={handleAddKeyDown}
          placeholder="Type and press Enter"
          className="bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 border border-gray-300 dark:border-gray-600"
          style={{
            flex: 1,
            fontSize: 13,
            padding: '3px 6px',
            borderRadius: 4,
            outline: 'none',
            minWidth: 0,
          }}
        />
        <button
          type="button"
          onClick={handleAddOption}
          className="bg-white dark:bg-slate-900 text-gray-700 dark:text-slate-200 border border-gray-300 dark:border-gray-600"
          style={{
            fontSize: 12,
            padding: '3px 8px',
            borderRadius: 4,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          Add
        </button>
      </div>
    </div>
  )
}
