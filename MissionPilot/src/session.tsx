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
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, ApiError } from './api/client'
import { clearSnapshotCache } from './inbox-data'
import { clearAllDrafts } from './task/drafts'
import type { Me } from './api/types'

const SESSION_NOT_KEPT = 'SESSION_NOT_KEPT'
const SIGN_IN_ME_TIMEOUT_MS = 15_000

export interface SessionContextValue {
  user: Me | null
  ready: boolean
  signIn(email: string, password: string): Promise<void>
  signOut(): Promise<void>
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null)
  const [ready, setReady] = useState(false)

  // On mount, ask the server who (if anyone) is signed in. A 401 rejects via
  // ApiError — that's just "not signed in", not a crash, so it resolves to null.
  useEffect(() => {
    let cancelled = false
    api
      .me()
      .then((me) => {
        if (!cancelled) setUser(me)
      })
      .catch(() => {
        if (!cancelled) setUser(null)
      })
      .finally(() => {
        if (!cancelled) setReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Any 401 anywhere in the app (client.ts) broadcasts this — drop the user
  // immediately so the UI falls back to the login screen. Also clears the offline
  // inbox cache: a session can end this way (not just via signOut()) on a shared
  // terminal, and a stale snapshot must not survive to seed the next sign-in.
  useEffect(() => {
    const onUnauthenticated = () => {
      setUser(null)
      clearSnapshotCache()
      clearAllDrafts()
    }
    window.addEventListener('pilot:unauthenticated', onUnauthenticated)
    return () => window.removeEventListener('pilot:unauthenticated', onUnauthenticated)
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    await api.signIn(email, password)
    // The password was accepted; a 401 here means the browser dropped the session cookie.
    let me: Me
    try {
      me = await api.me({ timeoutMs: SIGN_IN_ME_TIMEOUT_MS })
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) throw new ApiError(401, SESSION_NOT_KEPT)
      throw err
    }
    setUser(me)
  }, [])

  const signOut = useCallback(async () => {
    try {
      await api.logout()
    } catch {
      // Best effort: Sign Out must work with the engine down; the server session expires on its own.
    } finally {
      setUser(null)
      // A shared terminal must not seed the next operator's session with this one's
      // cached claims/offers.
      clearSnapshotCache()
      clearAllDrafts()
    }
  }, [])

  return <SessionContext.Provider value={{ user, ready, signIn, signOut }}>{children}</SessionContext.Provider>
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used within a SessionProvider')
  return ctx
}
