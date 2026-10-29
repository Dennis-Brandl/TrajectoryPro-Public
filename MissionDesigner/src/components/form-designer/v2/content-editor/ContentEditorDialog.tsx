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
import { useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TextStyle, Color } from '@tiptap/extension-text-style'
import { Bold, Italic, AlignLeft, AlignCenter, AlignRight } from 'lucide-react'
import type { Block, SizeAt, TypeToken } from '@mission/form-schema'
import { useFormDocumentStore } from '@/stores/formDocumentStore'
import { useFlowStore } from '@/stores/flowStore'
import { findBlock } from '@/lib/form-document/document-ops'
import { tokensToSpans, spansToTokens } from '@/lib/form-document/param-tokens'
import { ColorPickerField } from '../inspector/shared/ColorPickerField'
import { DeviceSizeField } from '../inspector/shared/DeviceSizeField'
import { ParamToken } from './ParamToken'
import type { StepNodeData } from '@/types/nodes'

// Stable reference for the no-inputs case: `?? []` inline would mint a new array on every
// render, and since this component is unconditionally mounted in the designer modal, that
// makes the useFlowStore selector's snapshot never compare equal — infinite update loop via
// useSyncExternalStore ("Maximum update depth exceeded"), even while the dialog itself renders
// null. Surfaced by FormDocumentDesignerModal.test.tsx nodes that omit data.inputs entirely.
const EMPTY_INPUTS: Array<{ id: string; name: string }> = []

/** Save writes plain block content, not the <p>-wrapped shape TipTap's getHTML() always
 *  produces for a single-paragraph doc — collapsing '<p>text</p>' back to 'text' keeps
 *  single-line blocks stable across repeated open/Save cycles instead of growing a <p>
 *  wrapper it never had. Multi-paragraph content (more than one top-level <p>) is left
 *  exactly as authored. */
function unwrapSingleParagraph(html: string): string {
  const pTagCount = (html.match(/<p\b/g) ?? []).length
  if (pTagCount === 1 && html.startsWith('<p>') && html.endsWith('</p>')) {
    return html.slice('<p>'.length, -'</p>'.length)
  }
  return html
}

/** WYSIWYG editor for text/header block content (spec 2026-08-11 §3). Opens via
 *  formDocumentStore.contentEditorBlockId (canvas double-click or the inspector's
 *  "Edit content…" button). Block-level controls (size / align / base color on empty
 *  selection) patch the block LIVE through updateBlock — undoable in the designer;
 *  content commits on Save only, Cancel discards. */
export function ContentEditorDialog() {
  const blockId = useFormDocumentStore((s) => s.contentEditorBlockId)
  const document = useFormDocumentStore((s) => s.document)
  const openNodeId = useFormDocumentStore((s) => s.openNodeId)
  const block = blockId ? (findBlock(document, blockId) as Block | undefined) : undefined
  const isTextual = block?.type === 'text' || block?.type === 'header'

  // The step's input parameters — token names are the input's `name` (the exported spec id).
  const inputs = useFlowStore((s) => {
    const node = s.nodes.find((n) => n.id === openNodeId)
    return ((node?.data as StepNodeData | undefined)?.inputs ?? EMPTY_INPUTS) as Array<{ id: string; name: string }>
  })

  const editor = useEditor({
    extensions: [StarterKit, TextStyle, Color, ParamToken],
    content: '',
    // TipTap v3 defaults shouldRerenderOnTransaction to FALSE, so the toolbar's
    // editor.isActive('bold'/'italic')-driven aria-pressed would freeze at its mount value —
    // toggling still worked, the indicator lied (deferred final-review finding M1). A dialog
    // re-rendering per transaction is cheap; correctness wins.
    shouldRerenderOnTransaction: true,
  })

  // Load content whenever the dialog opens for a block. Legacy TEXT blocks (not headers)
  // saved with block-level fontWeight:'bold' predate inline bold support in this editor —
  // migrate-on-open wraps the loaded content in <strong> so it looks identical; Save then
  // writes fontWeight:'normal' alongside the content so the block never round-trips through
  // both representations at once (spec 2026-08-11 §3, F3 final-review fix).
  useEffect(() => {
    if (!editor || !isTextual || !block) return
    const raw = (block as { content: string }).content
    const legacyBold = block.type === 'text' && (block as { fontWeight?: string }).fontWeight === 'bold'
    editor.commands.setContent(tokensToSpans(legacyBold ? `<strong>${raw}</strong>` : raw))
  }, [editor, blockId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!block || !isTextual) return null
  const b = block as {
    id: string
    content: string
    size?: TypeToken
    sizeAt?: SizeAt
    align?: string
    color?: string
    fontWeight?: string
  }
  const store = useFormDocumentStore.getState()
  const patch = (p: Record<string, unknown>) => store.updateBlock(b.id, p as Partial<Block>)
  // Same condition as the load-time migration above, re-read at Save time (fontWeight is
  // never touched by this dialog's own controls, so it's stable for the life of the dialog).
  const isLegacyBoldMigration = block.type === 'text' && b.fontWeight === 'bold'

  const save = () => {
    if (editor) {
      const content = unwrapSingleParagraph(spansToTokens(editor.getHTML()))
      // A pending bold migration always writes (it changes fontWeight even when the text
      // itself is untouched); otherwise skip the write entirely when content is unchanged —
      // a no-op Save must not dirty the designer or mint an undo entry.
      if (isLegacyBoldMigration || content !== b.content) {
        const contentPatch: Record<string, unknown> = { content }
        if (isLegacyBoldMigration) contentPatch.fontWeight = 'normal'
        store.updateBlock(b.id, contentPatch as Partial<Block>)
      }
    }
    store.closeContentEditor()
  }

  const applyColor = (c: string) => {
    if (!editor || editor.state.selection.empty) patch({ color: c })
    else editor.chain().focus().setColor(c).run()
  }

  const insertParam = (name: string) => {
    editor?.chain().focus().insertContent({ type: 'paramToken', attrs: { name } }).run()
  }

  return (
    <Dialog.Root open onOpenChange={(o) => !o && store.closeContentEditor()}>
      <Dialog.Portal>
        {/* z-[110]: one layer above the full-bleed designer modal (z-[100]). */}
        <Dialog.Overlay className="fixed inset-0 z-[110] bg-black/40" />
        <Dialog.Content
          aria-label="Edit content"
          aria-describedby={undefined}
          onKeyDown={(e) => e.stopPropagation()}
          className="bg-white dark:bg-slate-900 fixed left-1/2 top-1/2 z-[110] w-[640px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-lg shadow-xl"
        >
          <Dialog.Title style={{ fontSize: 14, fontWeight: 600, padding: '12px 16px 0' }}>
            Edit {block.type === 'header' ? 'header' : 'text'} content
          </Dialog.Title>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', flexWrap: 'wrap' }}>
            {/* Display defaults mirror the renderer's own: HeaderBlockView falls back to 'xl',
                TextBlockView to 'md' (deferred final-review finding M4). */}
            <DeviceSizeField
              inline
              size={b.size}
              sizeAt={b.sizeAt}
              fallback={block.type === 'header' ? 'xl' : 'md'}
              onChange={(p) => patch(p as Record<string, unknown>)}
            />
            <button
              type="button"
              aria-label="Bold"
              aria-pressed={editor?.isActive('bold') ?? false}
              onClick={() => editor?.chain().focus().toggleBold().run()}
              className="border border-gray-300 dark:border-gray-600"
              style={{ width: 32, height: 32, borderRadius: 6, cursor: 'pointer' }}
            >
              <Bold size={16} />
            </button>
            <button
              type="button"
              aria-label="Italic"
              aria-pressed={editor?.isActive('italic') ?? false}
              onClick={() => editor?.chain().focus().toggleItalic().run()}
              className="border border-gray-300 dark:border-gray-600"
              style={{ width: 32, height: 32, borderRadius: 6, cursor: 'pointer' }}
            >
              <Italic size={16} />
            </button>
            <ColorPickerField color={b.color ?? '#1e293b'} onChange={applyColor} />
            {(
              [
                ['left', AlignLeft],
                ['center', AlignCenter],
                ['right', AlignRight],
              ] as const
            ).map(([val, Icon]) => (
              <button
                key={val}
                type="button"
                aria-label={`Align ${val}`}
                aria-pressed={(b.align ?? 'left') === val}
                onClick={() => patch({ align: val })}
                className="border border-gray-300 dark:border-gray-600"
                style={{ width: 32, height: 32, cursor: 'pointer' }}
              >
                <Icon size={16} />
              </button>
            ))}
            <select
              aria-label="Insert parameter"
              value=""
              disabled={inputs.length === 0}
              title={inputs.length === 0 ? 'No input parameters on this step' : undefined}
              onChange={(e) => {
                if (e.target.value) insertParam(e.target.value)
              }}
              className="bg-white dark:bg-slate-900 border border-gray-300 dark:border-gray-600"
              style={{ fontSize: 13, padding: '4px 8px', borderRadius: 4, marginLeft: 'auto' }}
            >
              <option value="">{inputs.length === 0 ? 'No input parameters' : 'Insert parameter…'}</option>
              {inputs.map((p) => (
                <option key={p.id} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div
            className="border-y border-gray-200 dark:border-gray-700"
            style={{ minHeight: 180, maxHeight: '50vh', overflow: 'auto', padding: '8px 16px' }}
          >
            <EditorContent editor={editor} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: 12 }}>
            <button
              type="button"
              onClick={() => store.closeContentEditor()}
              className="px-4 py-2 text-sm font-medium rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              className="px-5 py-2 text-sm font-semibold rounded-md bg-blue-600 text-white shadow-sm hover:bg-blue-700"
            >
              Save
            </button>
          </div>
          {/* Chip styling for ParamToken spans inside the editor. */}
          <style>{`.tfk-param-chip{background:#dbeafe;color:#1d4ed8;border-radius:4px;padding:0 4px;font-size:0.9em;white-space:nowrap}`}</style>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
