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
import { useId } from 'react'
import { resolveSize } from '@mission/form-schema'
import type { SizeAt, TypeToken } from '@mission/form-schema'
import { useFormDocumentStore } from '@/stores/formDocumentStore'
import { clearSizeAt, sizePatchAt } from '@/lib/form-document/layout-ops'

const SIZE_TOKENS: TypeToken[] = ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl']

export interface SizePatch {
  size?: TypeToken
  sizeAt?: SizeAt
}

/**
 * Type-size select for the active device tab. Desktop edits `size`; Tablet/Phone edit
 * `sizeAt` and show where an un-overridden value is inherited from.
 */
export function DeviceSizeField({
  size,
  sizeAt,
  fallback,
  onChange,
  inline = false,
}: {
  size: TypeToken | undefined
  sizeAt?: SizeAt
  fallback: TypeToken
  onChange: (patch: SizePatch) => void
  /** Toolbar form: no visible label (the select is named "Text size"), auto width, no bottom margin. */
  inline?: boolean
}) {
  const id = useId()
  const bp = useFormDocumentStore((s) => s.activeBreakpoint)
  const block = { size, sizeAt }
  const value = resolveSize(size, sizeAt, bp, fallback)
  const clearable = bp !== 'base' && sizeAt?.[bp] !== undefined ? bp : null
  const overridden = clearable !== null
  const inheritedFrom = bp === 'phone' && sizeAt?.tablet !== undefined ? 'Tablet' : 'Desktop'

  return (
    <div style={inline ? { display: 'flex', alignItems: 'center', gap: 6 } : { marginBottom: 12 }}>
      {!inline && (
        <label
          htmlFor={id}
          className="text-gray-500 dark:text-gray-400"
          style={{ fontSize: 11, display: 'inline-block', marginBottom: 2 }}
        >
          Size
        </label>
      )}
      {bp !== 'base' && !overridden && (
        <span className="text-gray-500 dark:text-gray-400" style={{ fontSize: 11, marginLeft: 6 }}>
          {`(from ${inheritedFrom})`}
        </span>
      )}
      <select
        id={id}
        aria-label={inline ? 'Text size' : undefined}
        value={value}
        onChange={(e) => onChange(sizePatchAt(block, bp, e.target.value as TypeToken))}
        className="bg-white dark:bg-slate-900 border border-gray-300 dark:border-gray-600"
        style={
          inline
            ? { fontSize: 13, padding: '4px 8px', borderRadius: 4 }
            : { width: '100%', fontSize: 13, padding: '4px 8px', borderRadius: 4, display: 'block' }
        }
      >
        {SIZE_TOKENS.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      {clearable && (
        <button
          type="button"
          onClick={() => onChange({ sizeAt: clearSizeAt(block, clearable).sizeAt })}
          className="text-blue-600 dark:text-blue-400"
          style={{
            fontSize: 11,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            marginTop: inline ? 0 : 4,
            padding: 0,
          }}
        >
          Clear {clearable} override (inherit {inheritedFrom.toLowerCase()})
        </button>
      )}
    </div>
  )
}
