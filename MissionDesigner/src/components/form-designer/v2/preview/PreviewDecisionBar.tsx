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
import type { CSSProperties } from 'react'
import type { PreviewDecision } from './previewDecision'
import type { PreviewGate } from './usePreviewHost'

interface Props {
  decision: PreviewDecision
  gate: PreviewGate
  /** Spec D5: No/Reject is exempt from the signature requirement alone, mirroring the
   *  Pilot — true when `gate.ok`, or when the only missing field is the esignature block's.
   *  Yes/Continue always use `gate.ok` directly. */
  noGateOk: boolean
  onDecide: (outputValue: string, isNo?: boolean) => void
}

const BAR: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  padding: '10px 12px',
  borderTop: '1px solid #e2e8f0',
}

function btn(primary: boolean, disabled: boolean): CSSProperties {
  return {
    padding: '6px 16px',
    borderRadius: 6,
    fontSize: 13,
    border: primary ? 'none' : '1px solid #cbd5e1',
    background: primary ? (disabled ? '#93c5fd' : '#2563eb') : '#fff',
    color: primary ? '#fff' : '#334155',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
  }
}

/**
 * Host-chrome decision bar for the run preview: a single Continue (userInteraction) or a
 * Yes/No pair (yesNoStep), disabled until the completion gate opens. Clicking logs the
 * outcome via onDecide — the preview never navigates. Continue emits the completion
 * sentinel 'complete' (there is no routing value for a step completion, D§9.1).
 *
 * Spec D5: No/Reject is exempt from the signature requirement alone, exactly like the
 * Pilot — its `disabled` uses `noGateOk`, not `gate.ok`. Yes/Continue keep the full gate.
 */
export function PreviewDecisionBar({ decision, gate, noGateOk, onDecide }: Props) {
  const disabled = !gate.ok
  const noDisabled = !noGateOk
  const hint = disabled && gate.missing.length ? `Complete: ${gate.missing.join(', ')}` : undefined
  const noHint = noDisabled && gate.missing.length ? `Complete: ${gate.missing.join(', ')}` : undefined

  if (decision.kind === 'continue') {
    return (
      <div style={BAR} data-testid="preview-decision-bar">
        <button
          type="button"
          disabled={disabled}
          title={hint}
          onClick={() => onDecide('complete')}
          style={btn(true, disabled)}
        >
          {decision.label}
        </button>
      </div>
    )
  }
  return (
    <div style={BAR} data-testid="preview-decision-bar">
      <button
        type="button"
        disabled={noDisabled}
        title={noHint}
        onClick={() => onDecide(decision.no.value, true)}
        style={btn(false, noDisabled)}
      >
        {decision.no.label}
      </button>
      <button
        type="button"
        disabled={disabled}
        title={hint}
        onClick={() => onDecide(decision.yes.value)}
        style={btn(true, disabled)}
      >
        {decision.yes.label}
      </button>
    </div>
  )
}
