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
import type { Block, TimerBlock } from '@mission/form-schema'
import { DeviceSizeField } from '../shared/DeviceSizeField'
import { NumericInput } from '../shared/NumericInput'
import { BlockFieldNameInput } from '../shared/BlockFieldNameInput'
import { DefaultValueEditor } from '../shared/DefaultValueEditor'
import { useStepInputs } from '../shared/useStepInputs'

const fieldStyle: React.CSSProperties = { marginBottom: 10 }

/**
 * Inspector section for TimerBlock properties.
 *
 * Shows:
 * - Label text input
 * - Field Name: duplicate-checked via `BlockFieldNameInput` (needs `allBlocks`)
 * - Duration: three side-by-side H/M/S NumericInput fields, recomposed to durationSeconds
 * - Direction: segmented control (Countdown | Countup)
 * - Block Done: checkbox to disable the Done button until the timer expires
 * - Size: TypeToken select
 */
export function TimerSection({
  block: blockProp,
  onUpdate,
  allBlocks = [],
}: {
  block: Block
  onUpdate: (patch: Partial<Block>) => void
  allBlocks?: Block[]
}) {
  const block = blockProp as TimerBlock
  const stepInputs = useStepInputs()

  // Decompose durationSeconds into H/M/S
  const totalSeconds = block.durationSeconds
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  // Recompose to durationSeconds, ensuring minimum of 1 second
  const onDurationChange = (h: number, m: number, s: number) => {
    const newTotal = Math.max(1, h * 3600 + m * 60 + s)
    onUpdate({ durationSeconds: newTotal } as Partial<Block>)
  }

  return (
    <div style={{ padding: '4px 12px 12px' }}>
      {/* Label */}
      <div style={fieldStyle}>
        <label
          htmlFor="tfk-timer-label"
          className="text-gray-500 dark:text-gray-400"
          style={{ fontSize: 11, display: 'block', marginBottom: 2 }}
        >
          Label
        </label>
        <input
          id="tfk-timer-label"
          type="text"
          value={block.label}
          onChange={(e) => onUpdate({ label: e.target.value } as Partial<Block>)}
          className="bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 border border-gray-300 dark:border-gray-600"
          style={{
            width: '100%',
            fontSize: 13,
            padding: '4px 8px',
            borderRadius: 4,
            boxSizing: 'border-box',
            outline: 'none',
          }}
          placeholder="Timer label..."
        />
      </div>

      {/* Field Name */}
      <div style={fieldStyle}>
        <BlockFieldNameInput value={block.fieldName} blockId={block.id} allBlocks={allBlocks} onUpdate={onUpdate} />
      </div>

      {/* Duration */}
      <div style={fieldStyle}>
        <span
          className="text-gray-500 dark:text-gray-400"
          style={{ fontSize: 11, display: 'block', marginBottom: 2, userSelect: 'none' }}
        >
          Duration
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <div style={{ flex: 1 }}>
            <NumericInput
              label="H"
              value={hours}
              onChange={(h) => onDurationChange(h, minutes, seconds)}
              min={0}
              max={23}
              step={1}
            />
          </div>
          <div style={{ flex: 1 }}>
            <NumericInput
              label="M"
              value={minutes}
              onChange={(m) => onDurationChange(hours, m, seconds)}
              min={0}
              max={59}
              step={1}
            />
          </div>
          <div style={{ flex: 1 }}>
            <NumericInput
              label="S"
              value={seconds}
              onChange={(s) => onDurationChange(hours, minutes, s)}
              min={0}
              max={59}
              step={1}
            />
          </div>
        </div>
      </div>

      {/* Direction segmented control */}
      <div style={fieldStyle}>
        <span
          className="text-gray-500 dark:text-gray-400"
          style={{ fontSize: 11, display: 'block', marginBottom: 2, userSelect: 'none' }}
        >
          Direction
        </span>
        <div style={{ display: 'flex' }}>
          <button
            type="button"
            className={`border border-gray-300 dark:border-gray-600 ${block.direction === 'countdown' ? 'bg-blue-500 text-white' : 'bg-slate-100 dark:bg-slate-800 text-gray-700 dark:text-slate-200'}`}
            style={{
              flex: 1,
              fontSize: 12,
              padding: '4px 12px',
              cursor: 'pointer',
              borderRadius: '4px 0 0 4px',
            }}
            onClick={() => onUpdate({ direction: 'countdown' } as Partial<Block>)}
          >
            Countdown
          </button>
          <button
            type="button"
            className={`border border-gray-300 dark:border-gray-600 ${block.direction === 'countup' ? 'bg-blue-500 text-white' : 'bg-slate-100 dark:bg-slate-800 text-gray-700 dark:text-slate-200'}`}
            style={{
              flex: 1,
              fontSize: 12,
              padding: '4px 12px',
              cursor: 'pointer',
              borderRadius: '0 4px 4px 0',
            }}
            onClick={() => onUpdate({ direction: 'countup' } as Partial<Block>)}
          >
            Countup
          </button>
        </div>
      </div>

      {/* Block Done checkbox */}
      <div style={fieldStyle}>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={block.blockDone ?? false}
            onChange={(e) => onUpdate({ blockDone: e.target.checked } as Partial<Block>)}
            style={{ cursor: 'pointer' }}
          />
          <span className="text-gray-700 dark:text-slate-200" style={{ fontSize: 13 }}>
            Block Done until timer expires or is stopped
          </span>
        </label>
      </div>

      {/* Size */}
      <DeviceSizeField
        size={block.size}
        sizeAt={block.sizeAt}
        fallback="md"
        onChange={(patch) => onUpdate(patch as Partial<Block>)}
      />

      {/* Default Value */}
      <DefaultValueEditor
        source={block.defaultSource}
        stepInputs={stepInputs}
        onChange={(next) => onUpdate({ defaultSource: next } as Partial<Block>)}
      />
    </div>
  )
}
