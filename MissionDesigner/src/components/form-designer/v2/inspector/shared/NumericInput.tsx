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

import { useState, useEffect } from 'react'

/**
 * A numeric input with Arrow Up/Down stepping support.
 *
 * - ArrowUp/Down: step by `step` (default 1)
 * - Shift+ArrowUp/Down: step by `step * 10`
 * - Values are clamped to [min, max] and rounded to the nearest integer.
 *
 * Uses a local draft state to buffer intermediate input (e.g., empty string
 * while backspacing), so that the user can freely edit without the input
 * snapping back mid-keystroke. On blur, the draft is reset to the committed
 * store value if it is invalid.
 */
interface NumericInputProps {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  label: string
}

export function NumericInput({ value, onChange, min, max, step = 1, label }: NumericInputProps) {
  const [localDraft, setLocalDraft] = useState(String(Math.round(value)))

  // Sync draft when the value prop changes (e.g., different element selected,
  // or ArrowUp/Down keystroke updated the store).
  useEffect(() => {
    setLocalDraft(String(Math.round(value)))
  }, [value])

  const clamp = (v: number): number => {
    let result = Math.round(v)
    if (min !== undefined && result < min) result = min
    if (max !== undefined && result > max) result = max
    return result
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      const increment = e.shiftKey ? step * 10 : step
      onChange(clamp(value + increment))
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      const decrement = e.shiftKey ? step * 10 : step
      onChange(clamp(value - decrement))
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Always update the draft so the user can backspace through any value
    setLocalDraft(e.target.value)
    // Only commit to the store when the input parses to a valid number
    const parsed = parseInt(e.target.value, 10)
    if (!isNaN(parsed)) {
      onChange(clamp(parsed))
    }
  }

  const handleBlur = () => {
    // If the user leaves with an invalid draft (e.g. empty string), snap back
    // to the last committed store value so the input is never blank.
    setLocalDraft(String(Math.round(value)))
  }

  return (
    <label style={{ display: 'block', width: '100%' }}>
      <span
        className="text-gray-500 dark:text-gray-400"
        style={{
          fontSize: 11,
          display: 'block',
          marginBottom: 2,
          userSelect: 'none',
        }}
      >
        {label}
      </span>
      <input
        type="number"
        value={localDraft}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        min={min}
        max={max}
        step={step}
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
    </label>
  )
}
