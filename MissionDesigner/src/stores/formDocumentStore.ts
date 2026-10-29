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
import { create } from 'zustand'
import { temporal } from 'zundo'
import {
  convertButtons as convertButtonsOp,
  type Block,
  type ConvertButtonsResult,
  type FormDocument,
  type StepKind,
} from '@mission/form-schema'
import type { BreakpointKey } from '@mission/form-schema'
import type { ActionLabelDraft } from '@/lib/form-document/action-labels'
import {
  emptyDocument,
  updateBlockInDocument,
  deleteBlockFromDocument,
  insertBlockIntoDocument,
  insertBlockIntoBottomBar,
  duplicateBlockInDocument,
  findBlock,
  BOTTOM_BAR_PLACEHOLDER_ID,
} from '@/lib/form-document/document-ops'
import {
  createDefaultBlock,
  cloneBlockWithFreshIdentity,
  type PaletteBlockType,
} from '@/lib/form-document/create-block'
import {
  moveBlock as moveBlockOp,
  moveRow as moveRowOp,
  insertBlockAt as insertBlockAtOp,
  type MoveTarget,
  type RowTarget,
} from '@/lib/form-document/structural-ops'
import { stepKindOfNode } from '@/lib/form-document/step-kind'
import { generateOID, WORKER_INTERNAL } from '@/lib/snowflake'
import { useFlowStore } from '@/stores/flowStore'
import { resizeSpan as resizeSpanOp } from '@/lib/form-document/span-resize'
import { arrangeColumns as arrangeColumnsOp, ownRowTarget, rowAboveTarget } from '@/lib/form-document/column-ops'

/** The open form's step kind, looked up from the flow node the editor was opened for. */
function openStepKind(openNodeId: string | null) {
  return stepKindOfNode(useFlowStore.getState().nodes.find((n) => n.id === openNodeId)?.type)
}

/** The canvas shows a display-only placeholder bottom bar. When a drop targets it, swap in a real
 *  footer (or the existing one) so the structural op sees a real section. Done inside the same
 *  `set` as the op, so it is ONE document change / undo step. */
function realizeFooter(doc: FormDocument, sectionId: string): { doc: FormDocument; sectionId: string } {
  if (sectionId !== BOTTOM_BAR_PLACEHOLDER_ID) return { doc, sectionId }
  const existing = doc.sections.find((s) => s.role === 'footer')
  if (existing) return { doc, sectionId: existing.id }
  const id = generateOID(WORKER_INTERNAL)
  return { doc: { ...doc, sections: [...doc.sections, { id, role: 'footer', rows: [] }] }, sectionId: id }
}

export type PreviewMode = 'edit' | 'preview'

interface FormDocumentState {
  openNodeId: string | null
  document: FormDocument
  selection: string | null
  activeBreakpoint: BreakpointKey
  isDirty: boolean
  clipboard: Block | null
  previewMode: PreviewMode
  // Host-chrome action-button labels, buffered for the modal's Save/Cancel transaction.
  actionDraft: ActionLabelDraft | null
  actionDirty: boolean
  // Which text/header block the WYSIWYG content editor dialog is open for (null = closed).
  contentEditorBlockId: string | null
  openForNode: (nodeId: string, document: FormDocument) => void
  close: () => void
  selectBlock: (blockId: string | null) => void
  updateBlock: (blockId: string, patch: Partial<Block>) => void
  deleteBlock: (blockId: string) => void
  insertBlock: (type: PaletteBlockType) => void
  /** Append a (button) block as a new row of the bottom bar, creating the footer when absent. */
  insertBlockInBottomBar: (block: Block) => void
  moveBlock: (blockId: string, target: MoveTarget) => void
  /** Column commands (right-click menu + Inspector): no-ops when they would change nothing. */
  moveIntoRowAbove: (blockId: string) => void
  moveToOwnRow: (blockId: string) => void
  arrangeColumns: (blockId: string, columns: number) => void
  resizeSpan: (leftId: string, rightId: string, deltaCols: number) => void
  moveRow: (rowId: string, target: RowTarget) => void
  insertBlockAt: (type: PaletteBlockType, target: MoveTarget) => void
  duplicateBlock: (blockId: string) => void
  copy: (blockId: string) => void
  cut: (blockId: string) => void
  paste: () => void
  /** Moves the open form onto job buttons: ONE document change (one undo step); untouched when nothing changes. */
  convertButtons: (stepKind: StepKind) => ConvertButtonsResult
  setActiveBreakpoint: (bp: BreakpointKey) => void
  setDocument: (document: FormDocument) => void
  setPreviewMode: (mode: PreviewMode) => void
  seedActions: (draft: ActionLabelDraft | null) => void
  updateActionDraft: (draft: ActionLabelDraft) => void
  openContentEditor: (blockId: string) => void
  closeContentEditor: () => void
}

export const useFormDocumentStore = create<FormDocumentState>()(
  temporal(
    (set, get) => ({
      openNodeId: null,
      document: emptyDocument(),
      selection: null,
      activeBreakpoint: 'base',
      isDirty: false,
      clipboard: null,
      previewMode: 'edit',
      actionDraft: null,
      actionDirty: false,
      contentEditorBlockId: null,

      openForNode: (nodeId, document) => {
        set({
          openNodeId: nodeId,
          document,
          selection: null,
          activeBreakpoint: 'base',
          isDirty: false,
          previewMode: 'edit',
          actionDraft: null,
          actionDirty: false,
          contentEditorBlockId: null,
        })
        useFormDocumentStore.temporal.getState().clear()
      },
      close: () =>
        set({
          openNodeId: null,
          document: emptyDocument(),
          selection: null,
          activeBreakpoint: 'base',
          isDirty: false,
          previewMode: 'edit',
          actionDraft: null,
          actionDirty: false,
          contentEditorBlockId: null,
        }),
      selectBlock: (blockId) => set({ selection: blockId }),
      updateBlock: (blockId, patch) =>
        set({ document: updateBlockInDocument(get().document, blockId, patch), isDirty: true }),
      deleteBlock: (blockId) =>
        set((s) => ({
          document: deleteBlockFromDocument(s.document, blockId),
          selection: s.selection === blockId ? null : s.selection,
          isDirty: true,
        })),
      insertBlock: (type) => {
        const block = createDefaultBlock(type, { stepKind: openStepKind(get().openNodeId), document: get().document })
        set((s) => ({ document: insertBlockIntoDocument(s.document, block), selection: block.id, isDirty: true }))
      },
      moveBlock: (blockId, target) =>
        set((s) => {
          let base = s.document
          let t = target
          if (target.kind === 'new-row') {
            const r = realizeFooter(base, target.sectionId)
            base = r.doc
            t = { ...target, sectionId: r.sectionId }
          }
          const document = moveBlockOp(base, blockId, t)
          if (document === s.document || document === base) return s // no-op: no new reference, no undo entry
          return { document, selection: blockId, isDirty: true }
        }),
      moveIntoRowAbove: (blockId) => {
        const target = rowAboveTarget(get().document, blockId)
        if (target) get().moveBlock(blockId, target)
      },
      moveToOwnRow: (blockId) => {
        const target = ownRowTarget(get().document, blockId)
        if (target) get().moveBlock(blockId, target)
      },
      arrangeColumns: (blockId, columns) =>
        set((s) => {
          const document = arrangeColumnsOp(s.document, blockId, columns)
          return document === s.document ? s : { document, selection: blockId, isDirty: true }
        }),
      resizeSpan: (leftId, rightId, deltaCols) =>
        set((s) => {
          const document = resizeSpanOp(s.document, leftId, rightId, deltaCols, s.activeBreakpoint)
          return document === s.document ? s : { document, isDirty: true }
        }),
      moveRow: (rowId, target) =>
        set((s) => {
          const r = realizeFooter(s.document, target.sectionId)
          const document = moveRowOp(r.doc, rowId, { ...target, sectionId: r.sectionId })
          if (document === s.document || document === r.doc) return s
          return { document, isDirty: true }
        }),
      insertBlockInBottomBar: (block) =>
        set((s) => ({
          document: insertBlockIntoBottomBar(s.document, block, () => generateOID(WORKER_INTERNAL)),
          selection: block.id,
          isDirty: true,
        })),
      convertButtons: (stepKind) => {
        const result = convertButtonsOp(get().document, stepKind, () => generateOID(WORKER_INTERNAL))
        if (result.changed) set({ document: result.document, isDirty: true })
        return result
      },
      insertBlockAt: (type, target) => {
        const block = createDefaultBlock(type, { stepKind: openStepKind(get().openNodeId), document: get().document })
        set((s) => {
          let base = s.document
          let t = target
          if (target.kind === 'new-row') {
            const r = realizeFooter(base, target.sectionId)
            base = r.doc
            t = { ...target, sectionId: r.sectionId }
          }
          return { document: insertBlockAtOp(base, block, t), selection: block.id, isDirty: true }
        })
      },
      duplicateBlock: (blockId) =>
        set((s) => {
          const { document, newId } = duplicateBlockInDocument(s.document, blockId)
          return { document, selection: newId, isDirty: true }
        }),
      copy: (blockId) => {
        const b = findBlock(get().document, blockId)
        if (b) set({ clipboard: structuredClone(b) })
      },
      cut: (blockId) =>
        set((s) => {
          const b = findBlock(s.document, blockId)
          if (!b) return s
          return {
            clipboard: structuredClone(b),
            document: deleteBlockFromDocument(s.document, blockId),
            selection: s.selection === blockId ? null : s.selection,
            isDirty: true,
          }
        }),
      paste: () =>
        set((s) => {
          if (!s.clipboard) return s
          const block = cloneBlockWithFreshIdentity(s.clipboard)
          return { document: insertBlockIntoDocument(s.document, block), selection: block.id, isDirty: true }
        }),
      setActiveBreakpoint: (bp) => set({ activeBreakpoint: bp }),
      setDocument: (document) => set({ document, isDirty: true }),
      setPreviewMode: (previewMode) => set({ previewMode }),
      seedActions: (draft) => set({ actionDraft: draft, actionDirty: false }),
      updateActionDraft: (draft) => set({ actionDraft: draft, actionDirty: true }),
      openContentEditor: (blockId) => set({ contentEditorBlockId: blockId }),
      closeContentEditor: () => set({ contentEditorBlockId: null }),
    }),
    {
      limit: 100,
      // Only the document is undoable; UI/ephemeral state (selection, breakpoint, dirty, openNodeId, clipboard) is not.
      partialize: (state) => ({ document: state.document }),
      // Record an undo entry only when the document reference actually changes — otherwise
      // selectBlock / setActiveBreakpoint / copy / no-op cut+paste push phantom entries that
      // light up the Undo button and add dead Ctrl+Z presses. All real mutations mint a new
      // document reference; all phantom sources leave it referentially identical.
      equality: (a, b) => a.document === b.document,
    },
  ),
)
