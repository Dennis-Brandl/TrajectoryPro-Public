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
import type { CheckboxBlock } from '@mission/form-schema'
import { useFormRenderer } from '../context'
import { GroupLabel, sizeClasses } from './common'

export function CheckboxBlockView({ block }: { block: CheckboxBlock }) {
  const { values, emit } = useFormRenderer()
  const raw = values[block.fieldName]
  const selected = Array.isArray(raw) ? raw : []

  const toggle = (value: string, checked: boolean) => {
    const next = checked ? [...selected, value] : selected.filter((v) => v !== value)
    // Emit in option order, not click order: this array is workflow data, and the same
    // selection must produce the same value however the operator happened to tick it.
    const canonical = block.options.map((o) => o.value).filter((v) => next.includes(v))
    emit({ kind: 'fieldChange', fieldName: block.fieldName, value: canonical })
  }

  return (
    <fieldset className={`tfk-fieldset ${sizeClasses(block.size, block.sizeAt, 'sm')}`}>
      <GroupLabel label={block.label} required={block.required} />
      {block.options.map((option) => (
        <label key={option.value} className="tfk-option">
          <input
            type="checkbox"
            checked={selected.includes(option.value)}
            onChange={(e) => toggle(option.value, e.target.checked)}
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  )
}
