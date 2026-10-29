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

import { useId, type InputHTMLAttributes } from 'react'
import styles from './TextInput.module.css'

export interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> {
  label: string
  helper?: string
  error?: string
}

export function TextInput({ label, helper, error, id, type = 'text', ...rest }: TextInputProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId

  return (
    <div className={styles.field}>
      <label htmlFor={inputId} className={styles.label}>
        {label}
      </label>
      <input
        {...rest}
        id={inputId}
        type={type}
        className={[styles.input, error ? styles.invalid : ''].join(' ').trim()}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error || helper ? `${inputId}-msg` : undefined}
      />
      {(error ?? helper) && (
        <p id={`${inputId}-msg`} className={error ? styles.error : styles.helper}>
          {error ?? helper}
        </p>
      )}
    </div>
  )
}
