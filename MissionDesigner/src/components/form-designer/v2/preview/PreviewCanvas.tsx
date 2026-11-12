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
import { useMemo } from 'react'
import { RotateCcw } from 'lucide-react'
import { FormDocumentView, StepButtonBar } from '@mission/form-renderer'
import { findESignatureBlock, stripButtonBlocks, withStepButtons } from '@mission/form-schema'
import '@mission/form-tokens/css/light'
import '@mission/form-renderer/layout.css'
import '@mission/form-renderer/controls.css'
import { useFlowStore } from '@/stores/flowStore'
import { useFormDocumentStore } from '@/stores/formDocumentStore'
import type { StepNodeData } from '@/types/nodes'
import { fillPreviewLists } from '@/lib/form-document/preview-lists'
import { BreakpointTabs, BREAKPOINT_FRAME_WIDTH } from '../BreakpointTabs'
import { stepKindOfNode } from '@/lib/form-document/step-kind'
import { useImageResolver } from '../useImageResolver'
import { usePreviewHost } from './usePreviewHost'
import { barStyleFromDraft, type ActionLabelDraft } from '@/lib/form-document/action-labels'
import { buttonJobsFromDecision, derivePreviewDecision, type PreviewDecision } from './previewDecision'

const EMPTY_DATA = {} as StepNodeData
const NO_OP = () => {}

/** Interactive run-mode preview: the real renderer driven by usePreviewHost, at the active
 *  breakpoint frame width, with a gate-gated decision bar + Restart. Mounted only while
 *  previewMode==='preview', so entering preview re-seeds the host from the current document.
 *  A fixed step (one with `buttonBar`) shows its form without Button blocks and the step's own
 *  bar below it, as Mission Pilot does; Back/Stop appear when allowed but do nothing here. */
export function PreviewCanvas() {
  const document = useFormDocumentStore((s) => s.document)
  const openNodeId = useFormDocumentStore((s) => s.openNodeId)
  const breakpoint = useFormDocumentStore((s) => s.activeBreakpoint)
  const images = useImageResolver()

  const node = useFlowStore((s) => s.nodes.find((n) => n.id === openNodeId))
  const workflowValues = useFlowStore((s) => s.workflowValues)
  const actionDraft = useFormDocumentStore((s) => s.actionDraft)
  const data = (node?.data as StepNodeData | undefined) ?? EMPTY_DATA
  const fixedBar = data.buttonBar
  // Lists bound to an input parameter show the elements Pilot will list (preview only). A legacy
  // step's one button is the form's own, with a centered one added where the form has none —
  // exactly what Mission Pilot shows (user ruling 2026-11-10).
  const stepKind = stepKindOfNode(node?.type)
  const formDocument = useMemo(() => (fixedBar ? stripButtonBlocks(document) : document), [document, fixedBar])
  const previewDocument = useMemo(() => {
    const filled = fillPreviewLists(formDocument, data.inputs, workflowValues)
    return fixedBar ? filled : withStepButtons(filled, stepKind)
  }, [formDocument, data.inputs, workflowValues, stepKind, fixedBar])
  const derived = derivePreviewDecision(node?.type ?? 'userInteractionStep', data, formDocument)
  // A fixed bar follows the Buttons panel as edited (before Save), like the canvas strip.
  const plainDecision = fixedBar && actionDraft ? withDraftLabels(derived, actionDraft) : derived
  const hasSignature = findESignatureBlock(formDocument) !== null
  const host = usePreviewHost(formDocument, plainDecision)
  const buttonJobs = buttonJobsFromDecision(plainDecision, host.gate, host.noGateOk, hasSignature)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <BreakpointTabs />
      {/* Auto margins, not justify-content:center — keeps both edges scrollable on overflow
          (see FormDocumentCanvas). */}
      <div className="bg-[#cbd5e1] dark:bg-muted" style={{ flex: 1, overflow: 'auto', display: 'flex', padding: 32 }}>
        <div
          data-testid="preview-frame"
          style={{
            width: BREAKPOINT_FRAME_WIDTH[breakpoint],
            flexShrink: 0,
            margin: '0 auto',
            alignSelf: 'flex-start',
            background: '#fff',
            boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <FormDocumentView
            key={host.instanceKey}
            document={previewDocument}
            mode="run"
            breakpoint={breakpoint}
            values={host.values}
            images={images}
            onEvent={host.onEvent}
            signature={host.signature}
            buttonJobs={buttonJobs}
          />
          {fixedBar && (
            <StepButtonBar
              kind={plainDecision.kind}
              barStyle={actionDraft ? barStyleFromDraft(actionDraft) : fixedBar}
              jobs={buttonJobs}
              onPress={(job) => host.onEvent({ kind: 'job', blockId: 'step-bar', job })}
              back={data.allowBack ? { onBack: NO_OP, disabled: false } : null}
              stop={data.allowStop ? { onStop: NO_OP, disabled: false } : null}
            />
          )}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '6px 12px',
              borderTop: '1px solid #e2e8f0',
            }}
          >
            <span data-testid="preview-last-decision" style={{ fontSize: 12, color: '#64748b' }}>
              {host.lastDecision ? `→ ${host.lastDecision} (no navigation)` : 'Preview — fill fields, watch the gate'}
            </span>
            <button
              type="button"
              aria-label="Restart preview"
              onClick={host.restart}
              style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer' }}
            >
              <RotateCcw size={14} /> Restart
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** The draft's text over the step's decision (routing values stay the step's). */
function withDraftLabels(decision: PreviewDecision, draft: ActionLabelDraft): PreviewDecision {
  if (decision.kind === 'yesno' && draft.kind === 'yesno') {
    return {
      ...decision,
      yes: { ...decision.yes, label: draft.yes || decision.yes.label },
      no: { ...decision.no, label: draft.no || decision.no.label },
    }
  }
  if (decision.kind === 'continue' && draft.kind === 'continue')
    return { ...decision, label: draft.label || decision.label }
  return decision
}
