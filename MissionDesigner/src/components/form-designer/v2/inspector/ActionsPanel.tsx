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
import { useMemo, useState, type CSSProperties } from 'react'
import { toast } from 'sonner'
import { Button } from '@mission/ui'
import type { FormDocument } from '@mission/form-schema'
import { useCanEditActiveSpec } from '@/hooks/useCanEditActiveSpec'
import { checkNeverStuck } from '@mission/form-schema'
import { useFormDocumentStore } from '@/stores/formDocumentStore'
import { useFlowStore } from '@/stores/flowStore'
import { stepKindOfNode } from '@/lib/form-document/step-kind'
import { FormButtonProblems } from './FormButtonProblems'
import type { ActionLabelDraft } from '@/lib/form-document/action-labels'

const labelSt: CSSProperties = { fontSize: 11, display: 'block', marginBottom: 2 }
const inputSt: CSSProperties = {
  width: '100%',
  fontSize: 13,
  padding: '4px 8px',
  borderRadius: 4,
  boxSizing: 'border-box',
}
const inputCls = 'bg-white dark:bg-slate-900 border border-gray-300 dark:border-gray-600'
const labelCls = 'text-gray-500 dark:text-gray-400'

/**
 * Edits the labels of the step's host-chrome decision buttons (Continue, or a Yes/No pair)
 * from inside the form designer. The draft is buffered by the modal and committed to the
 * node's uiParameters on Save — Cancel discards it. onKeyDown is stopped so typing here
 * (e.g. Backspace) never reaches the modal's block-delete shortcut.
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
  const nodeType = useFlowStore((s) => s.nodes.find((n) => n.id === openNodeId)?.type)
  const problems = useMemo(
    () => checkNeverStuck(document, stepKindOfNode(nodeType)).map((p) => p.message),
    [document, nodeType],
  )
  const canEdit = useCanEditActiveSpec()
  // Buttons the conversion could not give a job. Tied to the document they were computed for, so
  // they disappear as soon as the author edits the form (checkNeverStuck then speaks for itself).
  const [leftover, setLeftover] = useState<{ doc: FormDocument; messages: string[] } | null>(null)
  const extra = leftover && leftover.doc === document ? leftover.messages.filter((m) => !problems.includes(m)) : []
  const convert = () => {
    const result = useFormDocumentStore.getState().convertButtons(stepKindOfNode(nodeType))
    setLeftover({
      doc: result.document,
      messages: [...result.changes.filter((c) => /needs a job/i.test(c)), ...result.problems.map((p) => p.message)],
    })
    toast.success(result.changed ? result.changes.join(' ') : 'Nothing to convert.')
  }
  if (!draft) return null
  return (
    <div onKeyDown={(e) => e.stopPropagation()} style={{ padding: '10px 12px', borderBottom: '1px solid #e2e8f0' }}>
      <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', marginBottom: 6 }}>Actions</div>
      {draft.kind === 'continue' ? (
        <div>
          <label htmlFor="tfk-action-continue" className={labelCls} style={labelSt}>
            Continue button
          </label>
          <input
            id="tfk-action-continue"
            value={draft.label}
            onChange={(e) => onChange({ kind: 'continue', label: e.target.value })}
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
      <Button
        variant="outline"
        size="sm"
        className="mt-2"
        disabled={!canEdit}
        title={canEdit ? undefined : 'This workflow is read-only'}
        onClick={convert}
      >
        Convert buttons
      </Button>
      <FormButtonProblems messages={[...problems, ...extra]} />
    </div>
  )
}
