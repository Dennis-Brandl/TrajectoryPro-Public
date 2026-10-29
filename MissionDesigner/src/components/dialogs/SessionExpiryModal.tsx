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

// Phase 35 §4.6 Q2: in-place re-login happy path.

import { useState, type FormEvent } from 'react'
import { useSpecificationStore } from '@/stores/specificationStore'
import { clearPendingRetry } from '@/stores/specificationStore/sessionExpiry'

export function SessionExpiryModal({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const res = await fetch('/api/auth/sign-in/email', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      if (!res.ok) throw new Error('sign-in failed')
      // Re-trigger the retry via batchSave (dirty state is preserved)
      clearPendingRetry()
      await useSpecificationStore.getState().batchSave()
      onClose()
    } catch {
      setError('Sign-in failed. Please try again.')
    }
  }

  return (
    <div role="dialog" aria-label="Session expired" className="session-expiry-modal">
      <h2>Your session expired</h2>
      <p>Sign back in to save your changes.</p>
      <form onSubmit={handleSubmit}>
        <label>
          Email <input value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit">Sign in &amp; retry save</button>
      </form>
    </div>
  )
}
