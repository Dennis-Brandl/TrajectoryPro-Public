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
import type { Block, TypeToken } from '@mission/form-schema'
import type { SizeAt } from '@mission/form-schema'
import { ColorPickerField } from '../shared/ColorPickerField'
import { DeviceSizeField } from '../shared/DeviceSizeField'

const field: React.CSSProperties = { marginBottom: 12 }

export function AppearanceSection({ block, onUpdate }: { block: Block; onUpdate: (patch: Partial<Block>) => void }) {
  const isTextInput = block.type === 'textInput'
  const isDivider = block.type === 'divider'
  const hasSize = isTextInput || block.type === 'textarea'

  const color = isDivider
    ? ((block as { color?: string }).color ?? '#e2e8f0')
    : ((block as { color?: string }).color ?? '#1e293b')

  return (
    <div style={{ padding: '4px 12px 12px' }}>
      {hasSize && (
        <DeviceSizeField
          size={(block as { size?: TypeToken }).size}
          sizeAt={(block as { sizeAt?: SizeAt }).sizeAt}
          fallback="md"
          onChange={(patch) => onUpdate(patch as Partial<Block>)}
        />
      )}
      {isDivider && (
        <div style={field}>
          <span
            className="text-gray-500 dark:text-gray-400"
            style={{ fontSize: 11, display: 'block', marginBottom: 2 }}
          >
            Color
          </span>
          <ColorPickerField color={color} onChange={(c) => onUpdate({ color: c } as Partial<Block>)} />
        </div>
      )}
      {isDivider && (
        <div style={field}>
          <label
            htmlFor="tfk-weight"
            className="text-gray-500 dark:text-gray-400"
            style={{ fontSize: 11, display: 'block', marginBottom: 2 }}
          >
            Weight
          </label>
          <select
            id="tfk-weight"
            value={(block as { weight?: string }).weight ?? 'hairline'}
            onChange={(e) => onUpdate({ weight: e.target.value } as Partial<Block>)}
            className="bg-white dark:bg-slate-900 border border-gray-300 dark:border-gray-600"
            style={{ width: '100%', fontSize: 13, padding: '4px 8px', borderRadius: 4 }}
          >
            <option value="hairline">Hairline</option>
            <option value="thick">Thick</option>
          </select>
        </div>
      )}
    </div>
  )
}
