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
import type { ComponentType } from 'react'
import {
  Type,
  Heading,
  TextCursorInput,
  AlignLeft,
  CheckSquare,
  CircleDot,
  Image,
  Video,
  Minus,
  Timer,
  Signature,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'
import type { LucideProps } from 'lucide-react'
import { useDraggable } from '@dnd-kit/core'
import { cn } from '@mission/ui'
import { findESignatureBlock } from '@mission/form-schema'
import type { PaletteBlockType } from '@/lib/form-document/create-block'
import { useFormDocumentStore } from '@/stores/formDocumentStore'
import { paletteDragId } from './dnd/dragTypes'
import { PaneResizeHandle } from './PaneResizeHandle'

interface PaletteItem {
  type: PaletteBlockType
  icon: ComponentType<LucideProps>
  label: string
}

/** 11 types: v1's 9 + header + esignature. No Button: a step's buttons belong to its fixed
 *  button row, edited in the Buttons panel (spec 2026-11-11). */
export const PALETTE_ITEMS: PaletteItem[] = [
  { type: 'text', icon: Type, label: 'Text' },
  { type: 'header', icon: Heading, label: 'Header' },
  { type: 'textInput', icon: TextCursorInput, label: 'Text Input' },
  { type: 'textarea', icon: AlignLeft, label: 'Multi Line Text' },
  { type: 'checkbox', icon: CheckSquare, label: 'Checkbox Group' },
  { type: 'radio', icon: CircleDot, label: 'Radio Group' },
  { type: 'image', icon: Image, label: 'Image' },
  { type: 'video', icon: Video, label: 'Video' },
  { type: 'divider', icon: Minus, label: 'Divider' },
  { type: 'timer', icon: Timer, label: 'Timer' },
  { type: 'esignature', icon: Signature, label: 'E-signature' },
]

/** Left palette column. Click-to-insert + drag-to-insert. Collapsed/width state is local ephemeral UI. */
export function FormPalette() {
  const [collapsed, setCollapsed] = useState(false)
  const [width, setWidth] = useState(224)
  const insertBlock = useFormDocumentStore((s) => s.insertBlock)
  const document = useFormDocumentStore((s) => s.document)
  const hasSignature = findESignatureBlock(document) !== null
  return (
    <div
      className={cn(
        'relative border-r border-border bg-background flex flex-col shrink-0 overflow-x-hidden select-none',
        collapsed && 'w-12',
      )}
      style={collapsed ? undefined : { width }}
    >
      {!collapsed && (
        <PaneResizeHandle
          width={width}
          min={160}
          max={400}
          direction={1}
          onResize={setWidth}
          label="Resize elements pane"
        />
      )}
      <div
        className={cn(
          'flex items-center border-b border-border h-10 shrink-0',
          collapsed ? 'justify-center py-2' : 'justify-between px-3 py-2',
        )}
      >
        {!collapsed && <span className="text-xs font-semibold text-foreground uppercase tracking-wide">Elements</span>}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? 'Expand palette' : 'Collapse palette'}
          aria-label={collapsed ? 'Expand palette' : 'Collapse palette'}
          className="text-muted-foreground"
          style={{ cursor: 'pointer', background: 'transparent', border: 'none' }}
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        </button>
      </div>
      <div className={cn('flex-1 overflow-y-auto overflow-x-hidden', collapsed ? 'py-1' : 'p-1')}>
        {PALETTE_ITEMS.map((item) => (
          <PaletteButton
            key={item.type}
            item={item}
            collapsed={collapsed}
            onInsert={insertBlock}
            disabledReason={item.type === 'esignature' && hasSignature ? 'A form can hold one e-signature' : undefined}
          />
        ))}
      </div>
    </div>
  )
}

function PaletteButton({
  item,
  collapsed,
  onInsert,
  disabledReason,
}: {
  item: PaletteItem
  collapsed: boolean
  onInsert: (type: PaletteBlockType) => void
  disabledReason?: string
}) {
  const disabled = disabledReason !== undefined
  const { attributes, listeners, setNodeRef } = useDraggable({ id: paletteDragId(item.type), disabled })
  const Icon = item.icon
  return (
    <button
      ref={setNodeRef}
      type="button"
      data-palette-drag={paletteDragId(item.type)}
      {...attributes}
      {...listeners}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (!disabled) onInsert(item.type)
      }}
      title={disabledReason ?? (collapsed ? item.label : undefined)}
      aria-label={collapsed ? item.label : undefined}
      className={cn(
        'w-full flex items-center gap-2 rounded-md text-left cursor-pointer hover:bg-muted text-foreground',
        collapsed ? 'justify-center py-2' : 'px-2.5 py-1.5',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
      style={{ background: 'transparent', border: 'none' }}
    >
      <Icon size={18} className="shrink-0 text-muted-foreground" />
      {!collapsed && <span className="text-[13px] whitespace-nowrap overflow-hidden text-ellipsis">{item.label}</span>}
    </button>
  )
}
