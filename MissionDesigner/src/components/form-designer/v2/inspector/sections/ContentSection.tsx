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
import type { Block } from '@mission/form-schema'
import { useFormDocumentStore } from '@/stores/formDocumentStore'
import { contentPreviewText } from '@/lib/form-document/param-tokens'

/**
 * Content section for text/header blocks.
 *
 * v1 edited `content` inline on-canvas via tiptap. Content edits now live in
 * the WYSIWYG ContentEditorDialog — this section only previews the stripped
 * text and opens that dialog.
 */
export function ContentSection({ block }: { block: Block }) {
  if (block.type === 'text' || block.type === 'header') {
    const preview = contentPreviewText((block as { content: string }).content)
    return (
      <div style={{ padding: '4px 12px 12px' }}>
        <span className="text-gray-500 dark:text-gray-400" style={{ fontSize: 11, display: 'block', marginBottom: 2 }}>
          Content
        </span>
        <p
          data-testid="content-preview"
          className="text-gray-700 dark:text-slate-200"
          style={{ fontSize: 12, margin: '0 0 8px', overflowWrap: 'anywhere' }}
        >
          {preview || '(empty)'}
        </p>
        <button
          type="button"
          onClick={() => useFormDocumentStore.getState().openContentEditor(block.id)}
          className="border border-gray-300 dark:border-gray-600"
          style={{ fontSize: 12, padding: '4px 12px', borderRadius: 4, cursor: 'pointer', width: '100%' }}
        >
          Edit content…
        </button>
      </div>
    )
  }
  return null
}
