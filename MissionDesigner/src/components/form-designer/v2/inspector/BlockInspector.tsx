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
import type { Block, FormDocument } from '@mission/form-schema'
import { useFormDocumentStore } from '@/stores/formDocumentStore'
import { findBlock } from '@/lib/form-document/document-ops'
import { ButtonSection } from './sections/ButtonSection'
import { AppearanceSection } from './sections/AppearanceSection'
import { ContentSection } from './sections/ContentSection'
import { DataSection } from './sections/DataSection'
import { ESignatureSection } from './sections/ESignatureSection'
import { ImageSection } from './sections/ImageSection'
import { LayoutSection } from './sections/LayoutSection'
import { OptionsSection } from './sections/OptionsSection'
import { ParameterBindingSection } from './sections/ParameterBindingSection'
import { TimerSection } from './sections/TimerSection'
import { VideoSection } from './sections/VideoSection'

export function BlockInspector() {
  const selection = useFormDocumentStore((s) => s.selection)
  const document = useFormDocumentStore((s) => s.document)
  const updateBlock = useFormDocumentStore((s) => s.updateBlock)
  const deleteBlock = useFormDocumentStore((s) => s.deleteBlock)

  const block = selection ? findBlock(document, selection) : undefined
  if (!block) {
    return (
      <div onKeyDown={(e) => e.stopPropagation()} style={{ padding: 12, fontSize: 12, color: '#64748b' }}>
        Select a block
      </div>
    )
  }

  const onUpdate = (patch: Partial<Block>) => updateBlock(block.id, patch)

  return (
    <div
      onKeyDown={(e) => e.stopPropagation()}
      style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto' }}
    >
      <div
        style={{
          padding: '8px 12px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid #e2e8f0',
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase' }}>{block.type}</span>
        <button
          type="button"
          onClick={() => deleteBlock(block.id)}
          className="text-red-600"
          style={{ fontSize: 12, cursor: 'pointer' }}
        >
          Delete
        </button>
      </div>
      {/* Section registry is populated in Tasks 11–14 */}
      {renderSections(block, onUpdate, document)}
    </div>
  )
}

// Extended in Tasks 11–14. Kept as a single dispatch point so section tasks are additive.
function renderSections(block: Block, onUpdate: (patch: Partial<Block>) => void, doc: FormDocument) {
  const t = block.type
  const hasAppearance = t === 'divider' || t === 'textInput' || t === 'textarea'
  const hasContent = t === 'text' || t === 'header'
  const hasData = t === 'textInput' || t === 'textarea' || t === 'checkbox' || t === 'radio'
  const hasOptions = t === 'checkbox' || t === 'radio'
  const hasParameterBinding =
    t === 'textInput' || t === 'textarea' || t === 'checkbox' || t === 'radio' || t === 'timer' || t === 'esignature'
  const isImage = t === 'image'
  const isVideo = t === 'video'
  const isTimer = t === 'timer'
  const isESignature = t === 'esignature'
  const allBlocks = doc.sections.flatMap((s) => s.rows.flatMap((r) => r.blocks))
  return (
    <>
      {hasAppearance && <AppearanceSection block={block} onUpdate={onUpdate} />}
      {t === 'button' && <ButtonSection block={block} onUpdate={onUpdate} />}
      {hasContent && <ContentSection block={block} />}
      {hasData && <DataSection block={block} onUpdate={onUpdate} allBlocks={allBlocks} />}
      {hasOptions && <OptionsSection block={block} onUpdate={onUpdate} />}
      {isESignature && <ESignatureSection block={block} onUpdate={onUpdate} allBlocks={allBlocks} />}
      {hasParameterBinding && <ParameterBindingSection block={block} onUpdate={onUpdate} />}
      {isImage && <ImageSection block={block} onUpdate={onUpdate} />}
      {isVideo && <VideoSection block={block} onUpdate={onUpdate} />}
      {isTimer && <TimerSection block={block} onUpdate={onUpdate} allBlocks={allBlocks} />}
      <LayoutSection block={block} onUpdate={onUpdate} />
    </>
  )
}
