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
import { useMemo, type CSSProperties } from 'react'
import { checkNeverStuck, type TypeToken } from '@mission/form-schema'
import { useFormDocumentStore } from '@/stores/formDocumentStore'
import { useFlowStore } from '@/stores/flowStore'
import { stepKindOfNode } from '@/lib/form-document/step-kind'
import type { StepNodeData } from '@/types/nodes'
import { FormButtonProblems } from './FormButtonProblems'
import { ColorPickerField } from './shared/ColorPickerField'
import type { ActionLabelDraft } from '@/lib/form-document/action-labels'

const labelSt: CSSProperties = { fontSize: 11, display: 'block', marginBottom: 2 }
const inputSt: CSSProperties = {
  width: '100%',
  fontSize: 13,
  padding: '4px 8px',
  borderRadius: 4,
  boxSizing: 'border-box',
}
const inputCls = 'bg-background border border-border'
const labelCls = 'text-muted-foreground'
const SIZE_TOKENS: TypeToken[] = ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl']
/** What an unset color shows in the swatch (the renderer then uses the theme accent). */
const THEME_SWATCH = '#3b82f6'

type ColorKey = 'color' | 'yesColor' | 'noColor'

/**
 * The step's Buttons: their text (Continue, or Yes and No) and, on a fixed button row, one text
 * size and the color(s). The draft is buffered by the modal and committed to the node on Save —
 * Cancel discards it. onKeyDown is stopped so typing here (e.g. Backspace) never reaches the
 * modal's block-delete shortcut.
 */
export function ActionsPanel({
  draft,
  onChange,
}: {
  draft: ActionLabelDraft | null
  onChange: (next: ActionLabelDraft) => void
}) {
  const document = useFormDocumentStore((s) => s.document)
  const openNodeId = useFormDocumentStore((s) => s.openNodeId)
  const node = useFlowStore((s) => s.nodes.find((n) => n.id === openNodeId))
  const nodeType = node?.type
  const fixed = !!(node?.data as StepNodeData | undefined)?.buttonBar
  const problems = useMemo(
    // A fixed bar has no button blocks to leave the operator stuck; only legacy forms are checked.
    () => (fixed ? [] : checkNeverStuck(document, stepKindOfNode(nodeType)).map((p) => p.message)),
    [document, nodeType, fixed],
  )
  if (!draft) return null
  const setStyle = (key: 'size' | ColorKey, value: string | undefined) => {
    const next = { ...draft } as Record<string, unknown>
    if (value) next[key] = value
    else delete next[key]
    onChange(next as ActionLabelDraft)
  }
  const colorField = (key: ColorKey, label: string) => {
    const value = (draft as Partial<Record<ColorKey, string>>)[key]
    return (
      <div style={{ marginTop: 8 }} data-testid={`tfk-action-${key}`}>
        <span className={labelCls} style={labelSt}>
          {label}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ColorPickerField color={value ?? THEME_SWATCH} onChange={(c) => setStyle(key, c)} />
          {value ? (
            <button
              type="button"
              onClick={() => setStyle(key, undefined)}
              className="text-link"
              style={{ fontSize: 11, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              Use theme color
            </button>
          ) : (
            <span className={labelCls} style={{ fontSize: 11 }}>
              Theme color
            </span>
          )}
        </div>
      </div>
    )
  }
  return (
    <div
      onKeyDown={(e) => e.stopPropagation()}
      style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', marginBottom: 6 }}>Buttons</div>
      {draft.kind === 'continue' ? (
        <div>
          <label htmlFor="tfk-action-continue" className={labelCls} style={labelSt}>
            Continue button
          </label>
          <input
            id="tfk-action-continue"
            value={draft.label}
            onChange={(e) => onChange({ ...draft, label: e.target.value })}
            className={inputCls}
            style={inputSt}
          />
        </div>
      ) : (
        <>
          <div style={{ marginBottom: 8 }}>
            <label htmlFor="tfk-action-yes" className={labelCls} style={labelSt}>
              Yes button
            </label>
            <input
              id="tfk-action-yes"
              value={draft.yes}
              onChange={(e) => onChange({ ...draft, yes: e.target.value })}
              className={inputCls}
              style={inputSt}
            />
          </div>
          <div>
            <label htmlFor="tfk-action-no" className={labelCls} style={labelSt}>
              No button
            </label>
            <input
              id="tfk-action-no"
              value={draft.no}
              onChange={(e) => onChange({ ...draft, no: e.target.value })}
              className={inputCls}
              style={inputSt}
            />
          </div>
        </>
      )}
      {fixed && (
        <>
          <div style={{ marginTop: 8 }}>
            <label htmlFor="tfk-action-size" className={labelCls} style={labelSt}>
              Text size
            </label>
            <select
              id="tfk-action-size"
              value={draft.size ?? ''}
              onChange={(e) => setStyle('size', e.target.value || undefined)}
              className={inputCls}
              style={inputSt}
            >
              <option value="">Default</option>
              {SIZE_TOKENS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          {draft.kind === 'continue' ? (
            colorField('color', 'Color')
          ) : (
            <>
              {colorField('yesColor', 'Yes color')}
              {colorField('noColor', 'No color')}
            </>
          )}
        </>
      )}
      <FormButtonProblems messages={problems} />
    </div>
  )
}
