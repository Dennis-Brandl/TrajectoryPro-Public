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
import { useRef } from 'react'
import type { Block, ImageBlock } from '@mission/form-schema'
import { useLibraryStore } from '@/stores/libraryStore'
import { getSpecImages, setSpecImage, dedupeImageFilename } from '@/stores/specificationStore/imageHelpers'

const fieldStyle: React.CSSProperties = { marginBottom: 10 }

/**
 * Image section for ImageBlock properties.
 *
 * Edits `src` (filename key into the spec's image map, or an http(s) URL) and
 * `objectFit`. "Choose file…" reads a picked image into a data URI, adds it to the
 * active spec's image map under a deduped filename, and points `src` at that key —
 * the same model the import pipeline uses. `layout.aspectRatio` is a v2 layout field
 * owned by the Layout section — this section must never read or emit `layout`.
 * `imageOid` is export identity (set by the image pipeline, not the designer).
 */
export function ImageSection({
  block: blockProp,
  onUpdate,
}: {
  block: Block
  onUpdate: (patch: Partial<Block>) => void
}) {
  const block = blockProp as ImageBlock
  const specId = useLibraryStore((s) => s.selectedSpecificationId)
  const fileRef = useRef<HTMLInputElement>(null)

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // reset so picking the same file again still fires onChange
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const name = dedupeImageFilename(getSpecImages(specId), file.name)
      setSpecImage(specId, name, String(reader.result))
      onUpdate({ src: name } as Partial<Block>)
    }
    reader.readAsDataURL(file)
  }

  return (
    <div style={{ padding: '4px 12px 12px' }}>
      {/* Source */}
      <div style={fieldStyle}>
        <label
          htmlFor="tfk-image-src"
          className="text-gray-500 dark:text-gray-400"
          style={{ fontSize: 11, display: 'block', marginBottom: 2 }}
        >
          Image Source (filename or URL)
        </label>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            id="tfk-image-src"
            type="text"
            value={block.src}
            onChange={(e) => onUpdate({ src: e.target.value } as Partial<Block>)}
            className="bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 border border-gray-300 dark:border-gray-600"
            style={{
              flex: 1,
              fontSize: 13,
              padding: '4px 8px',
              borderRadius: 4,
              boxSizing: 'border-box',
              outline: 'none',
              minWidth: 0,
            }}
            placeholder="filename.jpg or https://..."
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="bg-gray-50 dark:bg-slate-800 text-gray-700 dark:text-slate-300 border border-gray-300 dark:border-gray-600"
            style={{ fontSize: 12, padding: '4px 10px', borderRadius: 4, cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            Choose file…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={onPickFile}
            style={{ display: 'none' }}
            data-testid="image-file-input"
            aria-hidden="true"
          />
        </div>
      </div>

      {/* Object Fit */}
      <div style={fieldStyle}>
        <label
          htmlFor="tfk-image-fit"
          className="text-gray-500 dark:text-gray-400"
          style={{ fontSize: 11, display: 'block', marginBottom: 2 }}
        >
          Object Fit
        </label>
        <select
          id="tfk-image-fit"
          value={block.objectFit ?? 'contain'}
          onChange={(e) => onUpdate({ objectFit: e.target.value as ImageBlock['objectFit'] } as Partial<Block>)}
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
          <option value="contain">Contain</option>
          <option value="cover">Cover</option>
          <option value="fill">Fill</option>
        </select>
      </div>

      {/* Scale (%) — media-box width as % of the block's grid cell (schema range 10–300).
          Free typing is allowed mid-edit; blur clamps into range so Save can't fail on it. */}
      <div style={fieldStyle}>
        <label
          htmlFor="tfk-image-scale"
          className="text-gray-500 dark:text-gray-400"
          style={{ fontSize: 11, display: 'block', marginBottom: 2 }}
        >
          Scale (%)
        </label>
        <input
          id="tfk-image-scale"
          type="number"
          min={10}
          max={300}
          step={5}
          value={block.scalePercent ?? ''}
          placeholder="100"
          onChange={(e) => {
            const raw = e.target.value
            if (raw === '') {
              onUpdate({ scalePercent: undefined } as Partial<Block>)
              return
            }
            const n = Math.round(Number(raw))
            if (Number.isFinite(n)) onUpdate({ scalePercent: n } as Partial<Block>)
          }}
          onBlur={() => {
            const n = block.scalePercent
            if (n === undefined) return
            const clamped = Math.min(300, Math.max(10, n))
            if (clamped !== n) onUpdate({ scalePercent: clamped } as Partial<Block>)
          }}
          className="bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 border border-gray-300 dark:border-gray-600"
          style={{
            width: '100%',
            fontSize: 13,
            padding: '4px 8px',
            borderRadius: 4,
            boxSizing: 'border-box',
            outline: 'none',
          }}
        />
      </div>
    </div>
  )
}
