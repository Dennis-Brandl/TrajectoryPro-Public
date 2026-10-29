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
import type { InboxSnapshot } from './api/types'
import { THEME_CHANGED_EVENT } from './theme/site-theme'

const POLL_INTERVAL_MS = 10_000

export interface UseInboxResult {
  snapshot: InboxSnapshot | null
  offline: boolean
  stale: boolean
  /** When live data last arrived (fetch or push) — the top bar's "synced HH:MM". */
  syncedAt: Date | null
  /** The browser is online but the engine is not answering: the last fetch failed or the
   *  event stream dropped. Cleared by the next live snapshot. */
  unreachable: boolean
  refresh(): Promise<void>
}

/** Fired whenever the SSE inbox push lands — the Workflows tab uses it as a
 *  "something changed at this WC, re-poll now" nudge (spec 2026-08-19 §4.1). */
export const INBOX_CHANGED_EVENT = 'pilot:inbox-changed'

const CACHE_PREFIX = 'pilot:snapshot:'

function cacheKey(wcId: string): string {
  return CACHE_PREFIX + wcId
}

function readCache(wcId: string): InboxSnapshot | null {
  try {
    const raw = localStorage.getItem(cacheKey(wcId))
    return raw ? (JSON.parse(raw) as InboxSnapshot) : null
  } catch {
    return null // corrupt cache — treat as absent
  }
}

function writeCache(wcId: string, snapshot: InboxSnapshot): void {
  try {
    localStorage.setItem(cacheKey(wcId), JSON.stringify(snapshot))
  } catch {
    // best-effort only (e.g. storage quota) — in-memory state is still correct
  }
}

// The cache is keyed per work center, not per user — signing out one operator and
// signing in another on the same shared terminal must not seed the new session with
// the previous operator's claims/offers. session.tsx calls this from both signOut()
// and the 'pilot:unauthenticated' listener (a session drop from anywhere in the
// app), so neither path can leave a stale snapshot behind. Enumerates keys up front
// (mutating localStorage mid-iteration would skip entries) rather than tracking every
// wcId ever seen, since this module never keeps that list itself.
export function clearSnapshotCache(): void {
  try {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(CACHE_PREFIX)) keys.push(key)
    }
    for (const key of keys) localStorage.removeItem(key)
  } catch {
    // best-effort only (e.g. storage disabled) — nothing left to clear client-side
  }
}

// Inbox data layer for whichever work center the caller has selected.
// Two live sources write through to the same state + localStorage cache: an
// SSE 'inbox' push, and an unconditional 10s poll (the documented belt for
// the instance-status-only transitions the server does not push for) — plus
// an immediate cache seed (marked stale) and a one-shot refresh() whenever
// wcId changes. All fetches (initial, poll, and manual refresh()) are
// skipped while offline, leaving the cached snapshot in place; the SSE
// connection itself is left open regardless — EventSource reconnects
// natively and the server pushes a fresh snapshot on reconnect, so no
// client-side replay logic is needed here.
export function useInbox(wcId: string | null): UseInboxResult {
  const [snapshot, setSnapshot] = useState<InboxSnapshot | null>(null)
  const [stale, setStale] = useState(true)
  const [offline, setOffline] = useState(() => !navigator.onLine)
  const [syncedAt, setSyncedAt] = useState<Date | null>(null)
  const [unreachable, setUnreachable] = useState(false)

  // Mirrors state into refs so refresh() (a stable-ish callback captured by
  // the poll interval and by callers) always sees the CURRENT offline flag
  // and CURRENT wcId, not whatever was true when the closure was created.
  const offlineRef = useRef(offline)
  offlineRef.current = offline
  const wcIdRef = useRef(wcId)
  wcIdRef.current = wcId

  // genRef numbers every refresh() start and every SSE snapshot; appliedGen is the newest
  // one whose data is on screen. A result applies only if it is newer than what is applied,
  // so an older response never overwrites a live push or a newer poll, yet a slow poll still
  // lands when nothing newer has (overlapping polls cannot starve each other).
  const genRef = useRef(0)
  const appliedGenRef = useRef(0)

  const refresh = useCallback(async () => {
    if (!wcId || offlineRef.current) return
    const gen = ++genRef.current
    let next: InboxSnapshot
    try {
      next = await api.inbox(wcId)
    } catch (err) {
      if (wcIdRef.current === wcId && gen > appliedGenRef.current) setUnreachable(true)
      throw err
    }
    if (wcIdRef.current !== wcId) return // stale response from a since-switched work center
    if (gen <= appliedGenRef.current) return // a live push or a newer poll already applied
    appliedGenRef.current = gen
    setSnapshot(next)
    setStale(false)
    setSyncedAt(new Date())
    setUnreachable(false)
    writeCache(wcId, next)
  }, [wcId])

  useEffect(() => {
    if (!wcId) {
      setSnapshot(null)
      setStale(true)
      setSyncedAt(null)
      setUnreachable(false)
      return
    }

    setSnapshot(readCache(wcId))
    setStale(true)
    setSyncedAt(null)
    setUnreachable(false)
    refresh().catch(() => {})

    const source = new EventSource('/api/events?workCenterId=' + encodeURIComponent(wcId))
    source.addEventListener('inbox', (event) => {
      const next = JSON.parse((event as MessageEvent).data) as InboxSnapshot
      appliedGenRef.current = ++genRef.current
      setSnapshot(next)
      setStale(false)
      setSyncedAt(new Date())
      setUnreachable(false)
      writeCache(wcId, next)
      window.dispatchEvent(new Event(INBOX_CHANGED_EVENT))
    })

    // Spec 2026-10-09 §13: a theme save anywhere reaches every open Pilot without a reload;
    // useSiteTheme refetches /api/theme (If-None-Match keeps it to one small request).
    source.addEventListener('theme', () => {
      window.dispatchEvent(new Event(THEME_CHANGED_EVENT))
    })

    // The browser reconnects on its own; until a snapshot lands again the top bar must
    // not keep showing a green Online (final review). 1 = EventSource.OPEN.
    source.addEventListener('error', () => {
      if (source.readyState !== 1) setUnreachable(true)
    })

    const poll = setInterval(() => {
      refresh().catch(() => {})
    }, POLL_INTERVAL_MS)

    return () => {
      source.close()
      clearInterval(poll)
    }
  }, [wcId, refresh])

  useEffect(() => {
    const onOffline = () => setOffline(true)
    const onOnline = () => setOffline(false)
    window.addEventListener('offline', onOffline)
    window.addEventListener('online', onOnline)
    return () => {
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('online', onOnline)
    }
  }, [])

  return { snapshot, offline, stale, syncedAt, unreachable, refresh }
}
