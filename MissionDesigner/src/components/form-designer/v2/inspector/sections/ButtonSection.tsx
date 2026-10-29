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
import type { Block, ButtonBlock, ButtonJob } from '@mission/form-schema'
import { JOB_DEFAULT_LABEL, JOB_OUTPUT_VALUE } from '@mission/form-schema'
import { useFormDocumentStore } from '@/stores/formDocumentStore'
import { ColorPickerField } from '../shared/ColorPickerField'
import { DeviceSizeField } from '../shared/DeviceSizeField'

const JOBS: ButtonJob[] = ['continue', 'yes', 'no']
const labelCls = 'text-gray-500 dark:text-gray-400'
const labelSt: React.CSSProperties = { fontSize: 11, display: 'block', marginBottom: 2 }
const inputCls = 'bg-white dark:bg-slate-900 border border-gray-300 dark:border-gray-600'
const inputSt: React.CSSProperties = { width: '100%', fontSize: 13, padding: '4px 8px', borderRadius: 4 }
const field: React.CSSProperties = { marginBottom: 10 }

/** Inspector for Button blocks: job, label, colour, emphasis and per-device size. */
export function ButtonSection({ block, onUpdate }: { block: Block; onUpdate: (patch: Partial<Block>) => void }) {
  const draft = useFormDocumentStore((s) => s.actionDraft)
  const b = block as ButtonBlock
  const job = b.job

  // The label an empty-label job button follows (the step's Pilot button label).
  let placeholder = ''
  if (job) {
    if (draft?.kind === 'continue' && job === 'continue') placeholder = draft.label
    else if (draft?.kind === 'yesno' && job === 'yes') placeholder = draft.yes
    else if (draft?.kind === 'yesno' && job === 'no') placeholder = draft.no
    placeholder = placeholder || JOB_DEFAULT_LABEL[job]
  }

  return (
    <div style={{ padding: '4px 12px 12px' }}>
      <div style={field}>
        <label htmlFor="tfk-btn-job" className={labelCls} style={labelSt}>
          Job
        </label>
        <select
          id="tfk-btn-job"
          value={job ?? ''}
          onChange={(e) => {
            const next = e.target.value as ButtonJob
            if (!next) return
            onUpdate({ job: next, outputValue: JOB_OUTPUT_VALUE[next] } as Partial<Block>)
          }}
          className={inputCls}
          style={inputSt}
        >
          {!job && <option value="">None (old button)</option>}
          {JOBS.map((j) => (
            <option key={j} value={j}>
              {JOB_DEFAULT_LABEL[j]}
            </option>
          ))}
        </select>
        {!job && (
          <span className={labelCls} style={{ fontSize: 11, display: 'block', marginTop: 2 }}>
            Pick a job so this button replaces Pilot&apos;s own.
          </span>
        )}
      </div>

      <div style={field}>
        <label htmlFor="tfk-btn-label" className={labelCls} style={labelSt}>
          Label
        </label>
        <input
          id="tfk-btn-label"
          value={b.label}
          placeholder={placeholder}
          onChange={(e) => onUpdate({ label: e.target.value } as Partial<Block>)}
          className={inputCls}
          style={inputSt}
        />
      </div>

      {!job && (
        <div style={field}>
          <label htmlFor="tfk-btn-out" className={labelCls} style={labelSt}>
            Output Value
          </label>
          <input
            id="tfk-btn-out"
            value={b.outputValue}
            onChange={(e) => onUpdate({ outputValue: e.target.value } as Partial<Block>)}
            className={inputCls}
            style={inputSt}
          />
        </div>
      )}

      <div style={field}>
        <span className={labelCls} style={labelSt}>
          Color
        </span>
        <ColorPickerField color={b.color ?? '#3b82f6'} onChange={(c) => onUpdate({ color: c } as Partial<Block>)} />
      </div>

      <span className={labelCls} style={{ ...labelSt, marginTop: 10 }}>
        Emphasis
      </span>
      <div style={{ display: 'flex', marginBottom: 12 }}>
        {(['primary', 'secondary'] as const).map((val, i) => {
          const active = (b.emphasis ?? 'primary') === val
          return (
            <button
              key={val}
              type="button"
              aria-label={val === 'primary' ? 'Primary' : 'Secondary'}
              aria-pressed={active}
              onClick={() => onUpdate({ emphasis: val } as Partial<Block>)}
              className={`border border-gray-300 dark:border-gray-600 ${active ? 'bg-blue-500 text-white' : 'bg-slate-100 dark:bg-slate-800 text-gray-700 dark:text-slate-200'}`}
              style={{
                flex: 1,
                fontSize: 12,
                padding: '4px 12px',
                cursor: 'pointer',
                borderRadius: i === 0 ? '4px 0 0 4px' : '0 4px 4px 0',
              }}
            >
              {val === 'primary' ? 'Primary' : 'Secondary'}
            </button>
          )
        })}
      </div>

      <DeviceSizeField
        size={b.size}
        sizeAt={b.sizeAt}
        fallback="md"
        onChange={(patch) => onUpdate(patch as Partial<Block>)}
      />
    </div>
  )
}
