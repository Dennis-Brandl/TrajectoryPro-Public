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
import { toast } from 'sonner'
import { FormDocumentView } from '@mission/form-renderer'
import { checkNeverStuck, findESignatureBlock, hasJobButtons } from '@mission/form-schema'
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
import { buttonJobsFromDecision, derivePreviewDecision, withSignatureLabels } from './previewDecision'
import { PreviewDecisionBar } from './PreviewDecisionBar'

const EMPTY_DATA = {} as StepNodeData

/** Interactive run-mode preview: the real renderer driven by usePreviewHost, at the active
 *  breakpoint frame width, with a gate-gated decision bar + Restart. Mounted only while
 *  previewMode==='preview', so entering preview re-seeds the host from the current document. */
export function PreviewCanvas() {
  const document = useFormDocumentStore((s) => s.document)
  const openNodeId = useFormDocumentStore((s) => s.openNodeId)
  const breakpoint = useFormDocumentStore((s) => s.activeBreakpoint)
  const images = useImageResolver()

  const node = useFlowStore((s) => s.nodes.find((n) => n.id === openNodeId))
  const workflowValues = useFlowStore((s) => s.workflowValues)
  // Lists bound to an input parameter show the elements Pilot will list (preview only).
  const previewDocument = useMemo(
    () => fillPreviewLists(document, (node?.data as StepNodeData | undefined)?.inputs, workflowValues),
    [document, node?.data, workflowValues],
  )
  const plainDecision = derivePreviewDecision(
    node?.type ?? 'userInteractionStep',
    (node?.data as StepNodeData) ?? EMPTY_DATA,
    document,
  )
  const hasSignature = findESignatureBlock(document) !== null
  const decision = withSignatureLabels(plainDecision, hasSignature)
  const host = usePreviewHost(document, plainDecision)
  // Spec 2026-10-28 section 4: the form's own buttons replace the bar unless they would leave the author stuck.
  const formOwnsButtons = hasJobButtons(document) && checkNeverStuck(document, stepKindOfNode(node?.type)).length === 0
  const buttonJobs = buttonJobsFromDecision(plainDecision, host.gate, host.noGateOk, hasSignature)

  const onDecide = (value: string, isNo = false) => {
    host.decide(value, isNo)
    toast(`Preview decision: “${value}” — no navigation in preview`)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <BreakpointTabs />
      {/* Auto margins, not justify-content:center — keeps both edges scrollable on overflow
          (see FormDocumentCanvas). */}
      <div
        className="bg-[#cbd5e1] dark:bg-[#1e293b]"
        style={{ flex: 1, overflow: 'auto', display: 'flex', padding: 32 }}
      >
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
            values={host.values}
            images={images}
            onEvent={host.onEvent}
            signature={host.signature}
            buttonJobs={buttonJobs}
          />
          {!formOwnsButtons && (
            <PreviewDecisionBar decision={decision} gate={host.gate} noGateOk={host.noGateOk} onDecide={onDecide} />
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
