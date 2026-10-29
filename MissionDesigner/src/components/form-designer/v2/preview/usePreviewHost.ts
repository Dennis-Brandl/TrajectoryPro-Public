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
import { useState } from 'react'
import type { FormDocument, FormEvent, FormValues, SignatureDraft } from '@mission/form-schema'
import { computeValidation, findESignatureBlock } from '@mission/form-schema'
import { seedStaticDefaults } from '@/lib/form-document/seed-defaults'
import type { PreviewDecision } from './previewDecision'

const EMPTY_TIMERS: ReadonlySet<string> = new Set()
const EMPTY_SIGNATURE: SignatureDraft = { loginName: '', password: '' }

export interface PreviewGate {
  ok: boolean
  missing: string[]
}

export interface PreviewHostState {
  instanceKey: number
  values: FormValues
  gate: PreviewGate
  /** Spec D5, mirroring the Pilot (`TaskScreen.tsx`'s `noGateOk`): No/Reject is exempt from
   *  the signature requirement alone — true when the gate already passes, or when every
   *  missing field is the esignature block's own fieldName. Any other missing required field
   *  still gates No exactly as it gates Yes/Continue. */
  noGateOk: boolean
  lastDecision: string | null
  signature: SignatureDraft
  onEvent: (e: FormEvent) => void
  /** `isNo` lets the No/Reject decision bypass an all-signature gate (checked against
   *  `noGateOk` instead of `gate.ok`) — omit it (or pass false) for Yes/Continue and for an
   *  authored in-form button's `action` event, which always requires the full gate. */
  decide: (outputValue: string, isNo?: boolean) => void
  restart: () => void
}

/**
 * A single-screen run host for the Designer preview: it owns `values` and the completion
 * gate for ONE FormDocument, mirroring the gate half of the form-shell reference host
 * (`apps/form-shell/src/host/useFlowHost.ts`) with NO engine — the preview never sequences
 * to another screen, so decisions are logged (`lastDecision`), not navigated.
 *
 * Per HOST-CONTRACT: the gate is computed at mount (§2) with an empty settled-timer set
 * (correct because Restart remounts the renderer via `instanceKey` and discards its
 * timers, §3); thereafter the renderer's `validation` events (fieldChange + timer-settle)
 * are adopted. Closures are recreated each render so `decide`/`onEvent` read current state.
 *
 * FORWARD-NOTE (P4.2, deferred by decision): this host seeds `values`/`gate` only at mount
 * and on restart(), and the renderer keys on `instanceKey`, not document identity. That is
 * safe TODAY because the modal fully UNMOUNTS PreviewCanvas in edit mode, so every edit→preview
 * toggle remounts and re-seeds from the live document. If a future change keeps PreviewCanvas
 * mounted across toggles, or adds live-edit-while-preview, this host needs a document-keyed
 * resync (a `useEffect([document])` that re-seeds values+gate, or key the renderer on document
 * identity) — otherwise the preview would show a frozen pre-edit document.
 */
export function usePreviewHost(document: FormDocument, decision?: PreviewDecision): PreviewHostState {
  const [instanceKey, setInstanceKey] = useState(0)
  const [values, setValues] = useState<FormValues>(() => seedStaticDefaults(document))
  const [gate, setGate] = useState<PreviewGate>(() =>
    computeValidation(document, seedStaticDefaults(document), EMPTY_TIMERS, EMPTY_SIGNATURE),
  )
  const [lastDecision, setLastDecision] = useState<string | null>(null)
  const [signature, setSignature] = useState<SignatureDraft>(EMPTY_SIGNATURE)

  const esig = findESignatureBlock(document)
  // Spec D5: No never requires (or sends) a signature — the gate's `missing` list may still
  // name the esignature block's fieldName while the draft is incomplete, but that's the ONLY
  // entry No is allowed to ignore. Any other missing required field still gates No exactly as
  // it does Yes/Continue. Mirrors the Pilot's TaskScreen.tsx `noGateOk`.
  const noGateOk = gate.ok || (esig !== null && gate.missing.every((f) => f === esig.fieldName))

  const decide = (outputValue: string, isNo = false) => {
    if (!gate.ok && !(isNo && noGateOk)) return
    setLastDecision(outputValue)
  }

  const onEvent = (e: FormEvent) => {
    switch (e.kind) {
      case 'fieldChange':
        setValues((v) => ({ ...v, [e.fieldName]: e.value }))
        break
      case 'validation':
        setGate({ ok: e.ok, missing: e.missing })
        break
      case 'signature':
        setSignature({ loginName: e.loginName, password: e.password })
        break
      case 'action':
        decide(e.outputValue)
        break
      case 'job':
        // Spec 2026-10-28 section 5.3: same rules as the decision bar; a job that doesn't fit the step does nothing.
        if (e.job === 'continue') {
          if (decision?.kind === 'continue') decide('complete')
        } else if (decision?.kind === 'yesno') {
          if (e.job === 'yes') decide(decision.yes.value)
          else decide(decision.no.value, true)
        }
        break
      default:
        break // timerState is reflected by the validation the renderer emits alongside it
    }
  }

  const restart = () => {
    const seeded = seedStaticDefaults(document)
    setInstanceKey((k) => k + 1)
    setValues(seeded)
    setGate(computeValidation(document, seeded, EMPTY_TIMERS, EMPTY_SIGNATURE))
    setLastDecision(null)
    setSignature(EMPTY_SIGNATURE)
  }

  return { instanceKey, values, gate, noGateOk, lastDecision, signature, onEvent, decide, restart }
}
