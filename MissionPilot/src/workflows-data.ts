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
//
// Data layer for the Workflows tab (spec 2026-08-19 §4.1): the WC running list
// polls at 5s and the selected instance's live states at 2s — only while the
// tab is focused AND the app is online (tablet battery; no background traffic).
// The frozen diagram is fetched once per instance and cached for the session.
// The inbox SSE push doubles as a "re-poll now" nudge via INBOX_CHANGED_EVENT.
import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from './api/client'
import { INBOX_CHANGED_EVENT } from './inbox-data'
import type { PilotRuntimeWorkflow, RuntimeWorkflowDiagram, RuntimeWorkflowLiveStates } from './api/types'

const LIST_POLL_MS = 5_000
const LIVE_POLL_MS = 2_000

export interface UseWorkflowDiagramsResult {
  list: PilotRuntimeWorkflow[] | null
  diagram: RuntimeWorkflowDiagram | null
  live: RuntimeWorkflowLiveStates | null
  unavailable: boolean
}

function isGone(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 403 || err.status === 404)
}

export function useWorkflowDiagrams(
  wcId: string | null, active: boolean, online: boolean, selectedId: string | null,
): UseWorkflowDiagramsResult {
  const [list, setList] = useState<PilotRuntimeWorkflow[] | null>(null)
  const [diagram, setDiagram] = useState<RuntimeWorkflowDiagram | null>(null)
  const [live, setLive] = useState<RuntimeWorkflowLiveStates | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  // Frozen recipes never change after creation — cache per instance for the session.
  const diagramCache = useRef(new Map<string, RuntimeWorkflowDiagram>())

  // List: immediate + 5s + SSE nudge, gated on wcId/active/online.
  useEffect(() => {
    if (!wcId || !active || !online) return
    let alive = true
    const fetchList = () => {
      api.runtimeWorkflows(wcId)
        .then((next) => { if (alive) setList(next) })
        .catch(() => {}) // keep the last list; the status line covers offline/stale
    }
    fetchList()
    const interval = setInterval(fetchList, LIST_POLL_MS)
    window.addEventListener(INBOX_CHANGED_EVENT, fetchList)
    return () => {
      alive = false
      clearInterval(interval)
      window.removeEventListener(INBOX_CHANGED_EVENT, fetchList)
    }
  }, [wcId, active, online])

  // Selection: reset per-instance state, serve the diagram from cache or fetch once.
  useEffect(() => {
    setLive(null)
    setUnavailable(false)
    if (!selectedId) { setDiagram(null); return }
    const cached = diagramCache.current.get(selectedId)
    if (cached) { setDiagram(cached); return }
    setDiagram(null)
    let alive = true
    api.runtimeDiagram(selectedId)
      .then((d) => {
        diagramCache.current.set(selectedId, d)
        if (alive) setDiagram(d)
      })
      .catch((err) => { if (alive && isGone(err)) setUnavailable(true) })
    return () => { alive = false }
  }, [selectedId])

  // Live states: immediate + 2s + SSE nudge, gated like the list.
  useEffect(() => {
    if (!selectedId || !active || !online) return
    let alive = true
    const fetchLive = () => {
      api.runtimeLiveStates(selectedId)
        .then((next) => { if (alive) setLive(next) })
        .catch((err) => { if (alive && isGone(err)) setUnavailable(true) })
    }
    fetchLive()
    const interval = setInterval(fetchLive, LIVE_POLL_MS)
    window.addEventListener(INBOX_CHANGED_EVENT, fetchLive)
    return () => {
      alive = false
      clearInterval(interval)
      window.removeEventListener(INBOX_CHANGED_EVENT, fetchLive)
    }
  }, [selectedId, active, online])

  return { list, diagram, live, unavailable }
}
