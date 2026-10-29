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
import { useEffect, useState, type KeyboardEvent } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useStore } from 'zustand'
import { Undo2, Redo2, CircleHelp } from 'lucide-react'
import { toast } from 'sonner'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  pointerWithin,
  type CollisionDetection,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import { validateFormDocument } from '@mission/form-schema'
import { useFlowStore } from '@/stores/flowStore'
import { useFormDocumentStore } from '@/stores/formDocumentStore'
import { seedDocument, pruneEmptyFooters } from '@/lib/form-document/document-ops'
import type { StepNodeData } from '@/types/nodes'
import { FormDocumentCanvas } from './FormDocumentCanvas'
import { FormPalette, PALETTE_ITEMS } from './FormPalette'
import { BlockInspector } from './inspector/BlockInspector'
import { ContentEditorDialog } from './content-editor/ContentEditorDialog'
import { dropResolver } from './dnd/dropResolver'
import { parseDragId, preferPreciseZones } from './dnd/dragTypes'

import { PreviewCanvas } from './preview/PreviewCanvas'
import { ActionsPanel } from './inspector/ActionsPanel'
import { PaneResizeHandle } from './PaneResizeHandle'
import { deriveActionDraft, applyActionLabels } from '@/lib/form-document/action-labels'
import { ARRANGE_HELP_HREF } from './ArrangeTips'

/** The bar band only catches drops that miss every precise gap/slot (see preferPreciseZones). */
const collisionDetection: CollisionDetection = (args) => preferPreciseZones(pointerWithin(args))

export default function FormDocumentDesignerModal() {
  const openNodeId = useFormDocumentStore((s) => s.openNodeId)
  const selection = useFormDocumentStore((s) => s.selection)
  const previewMode = useFormDocumentStore((s) => s.previewMode)
  const canUndo = useStore(useFormDocumentStore.temporal, (t) => t.pastStates.length > 0)
  const canRedo = useStore(useFormDocumentStore.temporal, (t) => t.futureStates.length > 0)

  const [activeId, setActiveId] = useState<string | null>(null)
  // Inspector pane width (px), user-resizable via the drag handle on its left edge. Ephemeral UI.
  const [inspectorWidth, setInspectorWidth] = useState(280)
  // Host-chrome decision-button labels live in the store, buffered for the modal's Save/Cancel
  // transaction: seeded from the node on open, committed to uiParameters on Save only when
  // actually edited (so an untouched default never materializes a param), discarded on Cancel.
  const actionDraft = useFormDocumentStore((s) => s.actionDraft)
  // `distance: 4` is load-bearing, not a tuning knob: a bare PointerSensor "activates" on
  // pointerdown and installs a capture-phase `click` listener that swallows the click dnd-kit
  // assumes follows every drag — which would silently eat every palette click-to-insert. The
  // distance threshold defers activation until real movement is observed, so a stationary click
  // never trips it (see FormDocumentDesignerModal.test.tsx's ghost-click guard test).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  )
  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id))
  const onDragCancel = () => setActiveId(null)
  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null)
    const action = dropResolver(
      String(e.active.id),
      e.over ? String(e.over.id) : null,
      useFormDocumentStore.getState().document,
    )
    if (!action) return
    const store = useFormDocumentStore.getState()
    if (action.op === 'moveBlock') store.moveBlock(action.blockId, action.target)
    else if (action.op === 'moveRow') store.moveRow(action.rowId, action.target)
    else store.insertBlockAt(action.type, action.target)
  }

  // Seed on open + pause workflow undo while editing. The action-label draft is seeded via a
  // store action (not React setState), so it lives here in the effect alongside openForNode.
  useEffect(() => {
    if (!openNodeId) return
    const node = useFlowStore.getState().nodes.find((n) => n.id === openNodeId)
    const data = (node?.data as StepNodeData | undefined) ?? {}
    const document = seedDocument(data)
    useFormDocumentStore.getState().openForNode(openNodeId, document)
    useFormDocumentStore.getState().seedActions(deriveActionDraft(node?.type ?? '', data, document))
    useFlowStore.temporal.getState().pause()
    return () => useFlowStore.temporal.getState().resume()
  }, [openNodeId])

  const handleSave = () => {
    const { openNodeId: nodeId, document: rawDocument, actionDirty, actionDraft } = useFormDocumentStore.getState()
    if (!nodeId) return
    const document = pruneEmptyFooters(rawDocument) // an emptied bottom bar is not saved
    const result = validateFormDocument(document)
    if (!result.ok) {
      toast.error(`Form document is invalid: ${result.errors[0] ?? 'unknown error'}`)
      return
    }
    useFlowStore.temporal.getState().resume()
    const patch: Partial<StepNodeData> = { formDocument: document }
    if (actionDirty && actionDraft) {
      const node = useFlowStore.getState().nodes.find((n) => n.id === nodeId)
      patch.uiParameters = applyActionLabels((node?.data as StepNodeData | undefined)?.uiParameters ?? [], actionDraft)
    }
    useFlowStore.getState().updateNodeData(nodeId, patch)
    useFormDocumentStore.getState().close()
  }

  const handleCancel = () => {
    useFlowStore.temporal.getState().resume()
    useFormDocumentStore.getState().close()
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation() // isolate React Flow behind the modal
    if (previewMode === 'preview') return // no authoring mutations while previewing
    if ((e.key === 'Delete' || e.key === 'Backspace') && selection) {
      useFormDocumentStore.getState().deleteBlock(selection)
    } else if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
      e.preventDefault()
      useFormDocumentStore.temporal.getState().undo()
    } else if (
      (e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey) ||
      (e.key === 'y' && (e.ctrlKey || e.metaKey))
    ) {
      e.preventDefault()
      useFormDocumentStore.temporal.getState().redo()
    } else if (e.key === 'c' && (e.ctrlKey || e.metaKey) && selection) {
      e.preventDefault()
      useFormDocumentStore.getState().copy(selection)
    } else if (e.key === 'x' && (e.ctrlKey || e.metaKey) && selection) {
      e.preventDefault()
      useFormDocumentStore.getState().cut(selection)
    } else if (e.key === 'v' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      useFormDocumentStore.getState().paste()
    } else if (e.key === 'd' && (e.ctrlKey || e.metaKey) && selection) {
      e.preventDefault()
      useFormDocumentStore.getState().duplicateBlock(selection)
    }
  }

  return (
    <Dialog.Root open={!!openNodeId} onOpenChange={(o) => !o && handleCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-black/40" />
        <Dialog.Content
          aria-label="Form Designer (v2)"
          aria-describedby={undefined}
          onKeyDown={handleKeyDown}
          onEscapeKeyDown={(e) => {
            e.preventDefault()
            handleCancel()
          }}
          className="bg-white dark:bg-slate-900 fixed inset-0 z-[100] overflow-hidden"
          style={{ display: 'grid', gridTemplateRows: 'auto 1fr', gridTemplateColumns: `auto 1fr ${inspectorWidth}px` }}
        >
          {/* Radix requires a Title for a11y; the toolbar already conveys purpose visually, so keep it sr-only. */}
          <Dialog.Title className="sr-only">Form Designer</Dialog.Title>
          {/* Toolbar row: left tools span the full width, left-aligned over the palette. */}
          <div
            style={{
              gridColumn: '1 / 4',
              gridRow: '1',
              display: 'flex',
              justifyContent: 'flex-start',
              alignItems: 'center',
              gap: 8,
              padding: 8,
              borderBottom: '1px solid #e2e8f0',
            }}
          >
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <div
                role="group"
                aria-label="Editor mode"
                style={{ display: 'inline-flex', border: '1px solid #cbd5e1', borderRadius: 6, overflow: 'hidden' }}
              >
                {(['edit', 'preview'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={previewMode === m}
                    onClick={() => useFormDocumentStore.getState().setPreviewMode(m)}
                    style={{
                      padding: '4px 12px',
                      fontSize: 13,
                      border: 'none',
                      cursor: 'pointer',
                      background: previewMode === m ? '#2563eb' : '#fff',
                      color: previewMode === m ? '#fff' : '#334155',
                    }}
                  >
                    {m === 'edit' ? 'Edit' : 'Preview'}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  type="button"
                  aria-label="Undo"
                  title="Undo (Ctrl+Z)"
                  disabled={!canUndo || previewMode === 'preview'}
                  onClick={() => useFormDocumentStore.temporal.getState().undo()}
                  className="px-2 py-1 disabled:opacity-40"
                  style={{ cursor: canUndo && previewMode === 'edit' ? 'pointer' : 'default' }}
                >
                  <Undo2 size={16} />
                </button>
                <button
                  type="button"
                  aria-label="Redo"
                  title="Redo (Ctrl+Shift+Z)"
                  disabled={!canRedo || previewMode === 'preview'}
                  onClick={() => useFormDocumentStore.temporal.getState().redo()}
                  className="px-2 py-1 disabled:opacity-40"
                  style={{ cursor: canRedo && previewMode === 'edit' ? 'pointer' : 'default' }}
                >
                  <Redo2 size={16} />
                </button>
              </div>
              <a
                href={ARRANGE_HELP_HREF}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Form designer help"
                title="How to add, arrange and make columns of form elements"
                className="flex items-center gap-1 px-2 py-1 text-sm text-slate-600 hover:text-blue-700 dark:text-slate-300"
              >
                <CircleHelp size={16} /> Help
              </a>
            </div>
          </div>
          {/* Save/Cancel: a separate grid item pinned to the canvas column (col 2) so the primary
              actions stay centered over the canvas, independent of palette width/collapse. The
              full-column wrapper is pointerEvents:none so only the button group is interactive. */}
          <div
            style={{
              gridColumn: '2 / 3',
              gridRow: '1',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 8,
              pointerEvents: 'none',
            }}
          >
            <div style={{ display: 'flex', gap: 10, pointerEvents: 'auto' }}>
              <button
                type="button"
                onClick={handleCancel}
                className="px-4 py-2 text-sm font-medium rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="px-5 py-2 text-sm font-semibold rounded-md bg-blue-600 text-white shadow-sm hover:bg-blue-700"
              >
                Save
              </button>
            </div>
          </div>
          {previewMode === 'preview' ? (
            <div style={{ gridColumn: '1 / 4', overflow: 'hidden' }}>
              <PreviewCanvas />
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={collisionDetection}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDragCancel={onDragCancel}
            >
              {/* Left: palette */}
              <div style={{ overflow: 'hidden' }}>
                <FormPalette />
              </div>
              {/* Center: the v2 canvas */}
              <div style={{ overflow: 'hidden' }}>
                <FormDocumentCanvas />
              </div>
              {/* Inspector column: outer div stays non-scrolling so the resize handle spans the
                  full height; the inner div owns the vertical scroll. */}
              <div
                data-testid="inspector-slot"
                style={{
                  borderLeft: '1px solid #e2e8f0',
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                }}
              >
                <PaneResizeHandle
                  width={inspectorWidth}
                  min={240}
                  max={560}
                  direction={-1}
                  onResize={setInspectorWidth}
                  label="Resize properties pane"
                />
                <div style={{ flex: 1, overflow: 'auto' }}>
                  <ActionsPanel
                    draft={actionDraft}
                    onChange={(next) => useFormDocumentStore.getState().updateActionDraft(next)}
                  />
                  <BlockInspector />
                  <ContentEditorDialog />
                </div>
              </div>
              <DragOverlay dropAnimation={null}>{activeId ? <DragChip activeId={activeId} /> : null}</DragOverlay>
            </DndContext>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function DragChip({ activeId }: { activeId: string }) {
  const parsed = parseDragId(activeId)
  let label = 'Block'
  if (parsed?.kind === 'row') label = 'Row'
  else if (parsed?.kind === 'palette') label = PALETTE_ITEMS.find((p) => p.type === parsed.type)?.label ?? 'Block'
  else if (parsed?.kind === 'block') {
    const b = useFormDocumentStore
      .getState()
      .document.sections.flatMap((s) => s.rows)
      .flatMap((r) => r.blocks)
      .find((x) => x.id === parsed.id)
    label = b ? (PALETTE_ITEMS.find((p) => p.type === b.type)?.label ?? b.type) : 'Block'
  }
  return (
    <div
      style={{
        padding: '4px 10px',
        background: '#1e293b',
        color: '#fff',
        borderRadius: 6,
        fontSize: 12,
        boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
        pointerEvents: 'none',
      }}
    >
      {label}
    </div>
  )
}
