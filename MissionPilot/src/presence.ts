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
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api/client'

const HEARTBEAT_INTERVAL_MS = 30_000

export interface UsePresenceResult {
  away: boolean
  toggleAway(): void
  error: string | null
}

// Presence lifecycle for whichever work center the caller has selected.
// `wcId` is owned by the caller (App, per the phase-4b plan's Task 8) — this
// hook enters presence whenever wcId becomes non-null, sends a heartbeat
// every 30s while it stays set, and leaves presence on unmount OR when wcId
// changes to a different id/null. React always runs an effect's cleanup
// before the next run of that same effect, so switching wcId naturally
// leaves the old work center before entering the new one.
//
// The periodic tick ALWAYS sends an explicit status ('away' or 'back'),
// never omits it: the engine only writes a status when the request body
// carries one, so if toggleAway's one-shot heartbeat is ever dropped (its
// failure is swallowed), the next tick re-asserts the correct current state
// instead of leaving the server row stranded at whatever it last recorded.
export function usePresence(wcId: string | null): UsePresenceResult {
  const [away, setAway] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const awayRef = useRef(away)
  awayRef.current = away

  useEffect(() => {
    if (!wcId) return

    // Guards against a stale rejection: if wcId switches while this call is
    // still in flight, cleanup below flips `cancelled` before the promise
    // settles, so a late failure doesn't mis-set the error for the NEW wcId.
    let cancelled = false
    setError(null)
    // Re-entering (a fresh wcId, including a switch away from a prior one)
    // always writes status 'online' server-side (enterPresence) — mirror
    // that locally so a stale `away=true` from the OLD work center doesn't
    // show 'Back' in the header for a work center the operator just entered.
    setAway(false)
    api.enterPresence(wcId).catch(() => {
      if (!cancelled) setError('Could not enter work center.')
    })

    const interval = setInterval(() => {
      api.heartbeat(awayRef.current ? 'away' : 'back').catch(() => {})
    }, HEARTBEAT_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(interval)
      api.leavePresence(wcId).catch(() => {})
    }
  }, [wcId])

  const toggleAway = useCallback(() => {
    // Compute `next` and call the api OUTSIDE the setAway updater: React
    // (StrictMode, dev) invokes updater functions twice to surface impure
    // updaters, which would double-fire this side effect if it lived inside
    // the updater itself.
    const next = !awayRef.current
    setAway(next)
    api.heartbeat(next ? 'away' : 'back').catch(() => {})
  }, [])

  return { away, toggleAway, error }
}
