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
import { useEffect, useRef, type ReactNode } from 'react'
import { Copy, CopyPlus, Scissors, Clipboard, Trash2, ArrowUpToLine, ArrowDownToLine, Columns3 } from 'lucide-react'
import { ownRowTarget, rowAboveTarget } from '@/lib/form-document/column-ops'
import { useFormDocumentStore } from '@/stores/formDocumentStore'

interface BlockContextMenuProps {
  position: { x: number; y: number } | null
  targetBlockId: string | null
  onClose: () => void
}

/**
 * Right-click context menu for form blocks. Mirrors components/canvas/CanvasContextMenu:
 * a fixed-position menu dismissed by outside mousedown or Escape. Escape is handled in the
 * CAPTURE phase and its propagation stopped so it closes only this menu — never the Radix
 * Dialog that hosts the form designer (which would otherwise fire onEscapeKeyDown).
 */
export function BlockContextMenu({ position, targetBlockId, onClose }: BlockContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const deleteBlock = useFormDocumentStore((s) => s.deleteBlock)
  const duplicateBlock = useFormDocumentStore((s) => s.duplicateBlock)
  const copy = useFormDocumentStore((s) => s.copy)
  const cut = useFormDocumentStore((s) => s.cut)
  const paste = useFormDocumentStore((s) => s.paste)
  const clipboard = useFormDocumentStore((s) => s.clipboard)
  const formDoc = useFormDocumentStore((s) => s.document)
  const moveIntoRowAbove = useFormDocumentStore((s) => s.moveIntoRowAbove)
  const moveToOwnRow = useFormDocumentStore((s) => s.moveToOwnRow)
  const arrangeColumns = useFormDocumentStore((s) => s.arrangeColumns)

  useEffect(() => {
    if (!position) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        e.stopImmediatePropagation()
        e.preventDefault()
        onClose()
      }
    }
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    // Escape: capture phase, armed immediately, so it beats the Radix Dialog's bubble-phase
    // escape handler. Outside-mousedown: armed on the next frame so the opening right-click
    // does not immediately close the menu (same guard as CanvasContextMenu).
    document.addEventListener('keydown', onKey, true)
    const raf = requestAnimationFrame(() => document.addEventListener('mousedown', onDown))
    return () => {
      document.removeEventListener('keydown', onKey, true)
      cancelAnimationFrame(raf)
      document.removeEventListener('mousedown', onDown)
    }
  }, [position, onClose])

  if (!position) return null

  const run = (fn: () => void) => () => {
    fn()
    onClose()
  }

  return (
    <div
      ref={menuRef}
      role="menu"
      className="bg-white rounded-lg shadow-lg border border-slate-200 py-1 min-w-[160px]"
      style={{ position: 'fixed', left: position.x, top: position.y, zIndex: 100 }}
    >
      {targetBlockId ? (
        <>
          <MenuItem
            icon={<CopyPlus className="h-3.5 w-3.5" />}
            label="Duplicate"
            shortcut="Ctrl+D"
            onClick={run(() => duplicateBlock(targetBlockId))}
          />
          <MenuItem
            icon={<Copy className="h-3.5 w-3.5" />}
            label="Copy"
            shortcut="Ctrl+C"
            onClick={run(() => copy(targetBlockId))}
          />
          <MenuItem
            icon={<Scissors className="h-3.5 w-3.5" />}
            label="Cut"
            shortcut="Ctrl+X"
            onClick={run(() => cut(targetBlockId))}
          />
          <div className="my-1 border-t border-slate-200" />
          <MenuItem
            icon={<ArrowUpToLine className="h-3.5 w-3.5" />}
            label="Move into row above"
            title="Put this element beside the elements in the row above (makes columns)"
            disabled={!rowAboveTarget(formDoc, targetBlockId)}
            onClick={run(() => moveIntoRowAbove(targetBlockId))}
          />
          <MenuItem
            icon={<ArrowDownToLine className="h-3.5 w-3.5" />}
            label="Move to its own row"
            title="Take this element out of its row onto a new full-width row below"
            disabled={!ownRowTarget(formDoc, targetBlockId)}
            onClick={run(() => moveToOwnRow(targetBlockId))}
          />
          {[1, 2, 3, 4].map((n) => (
            <MenuItem
              key={n}
              icon={<Columns3 className="h-3.5 w-3.5" />}
              label={n === 1 ? 'Arrange in 1 column' : `Arrange in ${n} columns`}
              title={`Make this row hold ${n} element${n === 1 ? '' : 's'} side by side, pulling elements up from the rows below or pushing extras down`}
              onClick={run(() => arrangeColumns(targetBlockId, n))}
            />
          ))}
          <div className="my-1 border-t border-slate-200" />
          <MenuItem
            icon={<Clipboard className="h-3.5 w-3.5" />}
            label="Paste"
            shortcut="Ctrl+V"
            disabled={!clipboard}
            onClick={run(() => paste())}
          />
          <div className="my-1 border-t border-slate-200" />
          <MenuItem
            icon={<Trash2 className="h-3.5 w-3.5 text-red-500" />}
            label="Delete"
            danger
            onClick={run(() => deleteBlock(targetBlockId))}
          />
        </>
      ) : (
        <MenuItem
          icon={<Clipboard className="h-3.5 w-3.5" />}
          label="Paste"
          shortcut="Ctrl+V"
          disabled={!clipboard}
          onClick={run(() => paste())}
        />
      )}
    </div>
  )
}

function MenuItem({
  icon,
  label,
  onClick,
  shortcut,
  danger,
  disabled,
  title,
}: {
  icon: ReactNode
  label: string
  onClick: () => void
  shortcut?: string
  danger?: boolean
  disabled?: boolean
  title?: string
}) {
  return (
    <button
      type="button"
      role="menuitem"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`w-full px-3 py-1.5 text-sm flex items-center gap-2 ${
        disabled
          ? 'text-slate-300 cursor-not-allowed'
          : danger
            ? 'text-red-600 hover:bg-red-50 cursor-pointer'
            : 'text-slate-700 hover:bg-slate-100 cursor-pointer'
      }`}
    >
      {icon}
      <span className="flex-1 text-left">{label}</span>
      {shortcut && <span className="text-xs text-slate-400 ml-4">{shortcut}</span>}
    </button>
  )
}
