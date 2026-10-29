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

interface Props {
  value: string
  blockId: string
  allBlocks: Block[]
  onUpdate: (patch: { fieldName: string }) => void
}

/** Field-name editor with duplicate detection across all fieldName-bearing blocks.
 *  Store-agnostic: writes through `onUpdate`, unlike the v1 self-wiring FieldNameInput. */
export function BlockFieldNameInput({ value, blockId, allBlocks, onUpdate }: Props) {
  const duplicate = allBlocks.some(
    (b) => b.id !== blockId && 'fieldName' in b && (b as { fieldName?: string }).fieldName === value && value !== '',
  )
  return (
    <div>
      <span className="text-gray-500 dark:text-gray-400" style={{ fontSize: 11, display: 'block', marginBottom: 2 }}>
        Field Name
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onUpdate({ fieldName: e.target.value })}
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
      {duplicate && <span style={{ fontSize: 11, color: '#dc2626' }}>Duplicate field name</span>}
    </div>
  )
}
