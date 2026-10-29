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
import type { ReactNode } from 'react'
import { isNumberText, isPartialNumberText, type TextInputBlock } from '@mission/form-schema'
import { useFormRenderer } from '../context'
import { FieldLabel, sizeClasses } from './common'

export function TextInputBlockView({ block }: { block: TextInputBlock }) {
  const { values, emit } = useFormRenderer()
  const controlId = `${block.id}-control`
  const value = typeof values[block.fieldName] === 'string' ? (values[block.fieldName] as string) : ''
  const mode = block.inputMode ?? 'text'
  const onValue = (v: string) => emit({ kind: 'fieldChange', fieldName: block.fieldName, value: v })
  // Number mode refuses keystrokes and pastes that could never become a number; a value
  // that is still unfinished ('-', '.') or arrived non-numeric from the host is flagged
  // here, and computeValidation keeps the step from completing until it is fixed.
  const isNumber = mode === 'number'
  const errorId = `${block.id}-error`
  const numberError = isNumber && value.trim() !== '' && !isNumberText(value)

  let control: ReactNode
  if (mode === 'dropdown') {
    control = (
      <select
        id={controlId}
        className="tfk-control"
        aria-required={block.required || undefined}
        value={value}
        onChange={(e) => onValue(e.target.value)}
      >
        <option value="">{block.placeholder ?? 'Select...'}</option>
        {(block.listItems ?? []).map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    )
  } else if (mode === 'combobox') {
    const listId = `${block.id}-list`
    control = (
      <>
        <input
          id={controlId}
          className="tfk-control"
          list={listId}
          value={value}
          placeholder={block.placeholder}
          onChange={(e) => onValue(e.target.value)}
        />
        <datalist id={listId}>
          {(block.listItems ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </datalist>
      </>
    )
  } else {
    control = (
      <input
        id={controlId}
        className="tfk-control"
        aria-required={block.required || undefined}
        type={mode === 'password' ? 'password' : mode === 'phone' ? 'tel' : 'text'}
        inputMode={isNumber ? 'numeric' : undefined}
        aria-invalid={numberError || undefined}
        aria-describedby={numberError ? errorId : undefined}
        value={value}
        placeholder={block.placeholder}
        onChange={(e) => {
          if (isNumber && !isPartialNumberText(e.target.value)) return
          onValue(e.target.value)
        }}
      />
    )
  }

  return (
    <div className={`tfk-field ${sizeClasses(block.size, block.sizeAt, 'md')}`}>
      <FieldLabel label={block.label} required={block.required} htmlFor={controlId} />
      {control}
      {numberError && (
        <p id={errorId} className="tfk-error" role="alert">
          Enter a number
        </p>
      )}
    </div>
  )
}
