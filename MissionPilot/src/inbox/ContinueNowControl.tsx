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
import { api, ApiError } from '../api/client'
import { useToast } from '../toast'

const GENERIC_ERROR_COPY = 'Something went wrong — try again.'

// Spec 2026-10-13 §5.3/§6.7: an operator continues a waiting timed gate or repeating script early. Two steps so a stray
// tap can't skip a wait: Continue now opens an optional reason and a Confirm.
// onDone fires only on success, so a surrounding tooltip keeps a typed reason after a failure.
export function ContinueNowControl({ instanceId, stepInstanceId, stepName, disabled = false, disabledReason, onDone }: {
  instanceId: string; stepInstanceId: string; stepName: string
  disabled?: boolean; disabledReason?: string; onDone?(): void
}) {
  const { show } = useToast()
  const [asking, setAsking] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const close = () => { setAsking(false); setReason('') }
  const confirm = async () => {
    setBusy(true)
    try {
      await api.continueStep(instanceId, stepInstanceId, reason.trim() || undefined)
      show(`Continued: ${stepName}`)
      close()
      onDone?.()
    } catch (err) {
      // 403/409 carry the engine's operator-facing message ("Resume the workflow first", ...).
      show(err instanceof ApiError && (err.status === 403 || err.status === 409) ? err.message : GENERIC_ERROR_COPY)
    } finally {
      setBusy(false)
    }
  }

  if (!asking) {
    return (
      <button type="button" className="inbox-claim" aria-label={`Continue now: ${stepName}`}
        disabled={disabled} title={disabled ? disabledReason : undefined} onClick={() => setAsking(true)}>
        Continue now
      </button>
    )
  }
  return (
    <span className="continue-confirm">
      <input aria-label={`Reason for continuing ${stepName} (optional)`} placeholder="Reason (optional)"
        value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
      <button type="button" className="inbox-claim" disabled={busy || disabled} onClick={() => void confirm()}>Confirm</button>
      <button type="button" onClick={close}>Cancel</button>
    </span>
  )
}
