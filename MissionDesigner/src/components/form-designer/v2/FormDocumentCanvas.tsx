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
import { useMemo, useRef, useState, type MouseEvent } from 'react'
import { FormDocumentView } from '@mission/form-renderer'
import '@mission/form-tokens/css/light'
import '@mission/form-renderer/layout.css'
import '@mission/form-renderer/controls.css'
import './form-designer-edit.css'
import { JOB_DEFAULT_LABEL } from '@mission/form-schema'
import type { ButtonJobs } from '@mission/form-renderer'
import { useFormDocumentStore } from '@/stores/formDocumentStore'
import { findBlock, withBottomBarPlaceholder } from '@/lib/form-document/document-ops'
import { useImageResolver } from './useImageResolver'
import { BreakpointTabs, BREAKPOINT_FRAME_WIDTH } from './BreakpointTabs'
import { SelectionOverlay, innermostBlockIdAt } from './SelectionOverlay'
import { StructuralDragLayer } from './dnd/StructuralDragLayer'
import { BlockContextMenu } from './BlockContextMenu'
import { ArrangeTips } from './ArrangeTips'

export function FormDocumentCanvas() {
  const document = useFormDocumentStore((s) => s.document)
  const breakpoint = useFormDocumentStore((s) => s.activeBreakpoint)
  const selectBlock = useFormDocumentStore((s) => s.selectBlock)
  const actionDraft = useFormDocumentStore((s) => s.actionDraft)
  const buttonJobs = useMemo<ButtonJobs>(() => {
    const yesNo = actionDraft?.kind === 'yesno' ? actionDraft : null
    const on = (label: string | undefined, job: 'continue' | 'yes' | 'no') => ({
      enabled: true,
      label: label || JOB_DEFAULT_LABEL[job],
    })
    return {
      continue: on(actionDraft?.kind === 'continue' ? actionDraft.label : undefined, 'continue'),
      yes: on(yesNo?.yes, 'yes'),
      no: on(yesNo?.no, 'no'),
      signed: false,
    }
  }, [actionDraft])
  const shown = useMemo(() => withBottomBarPlaceholder(document), [document])
  const images = useImageResolver()
  const viewportRef = useRef<HTMLDivElement>(null)
  const isEmpty = document.sections.every((sec) => sec.rows.every((r) => r.blocks.length === 0))
  const [menu, setMenu] = useState<{ x: number; y: number; blockId: string | null } | null>(null)

  const onClick = (e: MouseEvent) => {
    selectBlock(innermostBlockIdAt(e.clientX, e.clientY))
  }

  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault()
    const blockId = innermostBlockIdAt(e.clientX, e.clientY)
    if (blockId) selectBlock(blockId)
    setMenu({ x: e.clientX, y: e.clientY, blockId })
  }

  const onDoubleClick = (e: MouseEvent) => {
    const blockId = innermostBlockIdAt(e.clientX, e.clientY)
    if (!blockId) return
    const block = findBlock(useFormDocumentStore.getState().document, blockId)
    if (block && (block.type === 'text' || block.type === 'header')) {
      selectBlock(blockId)
      useFormDocumentStore.getState().openContentEditor(blockId)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <BreakpointTabs />
      <ArrangeTips />
      {/* Auto margins (not justify-content:center) center the frame: when it overflows, a
          justify-centered flex child clips its left edge unreachably; auto margins collapse
          to 0 so both edges stay scrollable. */}
      <div
        className="bg-[#cbd5e1] dark:bg-[#1e293b]"
        style={{ flex: 1, overflow: 'auto', display: 'flex', padding: 32 }}
      >
        <div
          data-testid="bp-frame"
          style={{
            width: BREAKPOINT_FRAME_WIDTH[breakpoint],
            flexShrink: 0,
            margin: '0 auto',
            alignSelf: 'flex-start',
            position: 'relative',
            background: '#fff',
            boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
          }}
        >
          {/* Non-interactive overlay + click-to-select + right-click context menu. Blocks are `inert`; the overlay owns selection. */}
          <div
            ref={viewportRef}
            onClick={onClick}
            onContextMenu={onContextMenu}
            onDoubleClick={onDoubleClick}
            style={{ position: 'relative' }}
          >
            <FormDocumentView document={shown} mode="edit" images={images} buttonJobs={buttonJobs} />
            {isEmpty && (
              <p style={{ padding: 32, textAlign: 'center', fontSize: 13, color: '#64748b' }}>
                This form is empty. Click an element in the palette on the left to add it, or drag it here.
              </p>
            )}
            <SelectionOverlay viewportRef={viewportRef} />
            <StructuralDragLayer hostRef={viewportRef} />
          </div>
        </div>
      </div>
      <BlockContextMenu
        position={menu ? { x: menu.x, y: menu.y } : null}
        targetBlockId={menu?.blockId ?? null}
        onClose={() => setMenu(null)}
      />
    </div>
  )
}
