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
import type { TextareaBlock } from '@mission/form-schema'
import { useFormRenderer } from '../context'
import { FieldLabel, sizeClasses } from './common'

export function TextareaBlockView({ block }: { block: TextareaBlock }) {
  const { values, emit } = useFormRenderer()
  const controlId = `${block.id}-control`
  const value = typeof values[block.fieldName] === 'string' ? (values[block.fieldName] as string) : ''
  return (
    <div className={`tfk-field ${sizeClasses(block.size, block.sizeAt, 'md')}`}>
      <FieldLabel label={block.label} required={block.required} htmlFor={controlId} />
      <textarea
        id={controlId}
        className="tfk-control"
        aria-required={block.required || undefined}
        rows={block.rows ?? 4}
        value={value}
        placeholder={block.placeholder}
        onChange={(e) => emit({ kind: 'fieldChange', fieldName: block.fieldName, value: e.target.value })}
      />
    </div>
  )
}
