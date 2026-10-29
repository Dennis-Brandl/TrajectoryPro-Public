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
import type { RadioBlock } from '@mission/form-schema'
import { useFormRenderer } from '../context'
import { GroupLabel, sizeClasses } from './common'

export function RadioBlockView({ block }: { block: RadioBlock }) {
  const { values, emit } = useFormRenderer()
  const value = typeof values[block.fieldName] === 'string' ? values[block.fieldName] : ''
  return (
    <fieldset
      className={`tfk-fieldset ${sizeClasses(block.size, block.sizeAt, 'sm')}`}
      // Names the group's kind for assistive tech. Required-ness rides in the legend
      // instead of aria-required, matching checkbox groups — whose 'group' role has no
      // such state — so both read the same way rather than one announcing it twice.
      role="radiogroup"
    >
      <GroupLabel label={block.label} required={block.required} />
      {block.options.map((option) => (
        <label key={option.value} className="tfk-option">
          <input
            type="radio"
            name={block.id}
            checked={value === option.value}
            onChange={() => emit({ kind: 'fieldChange', fieldName: block.fieldName, value: option.value })}
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  )
}
