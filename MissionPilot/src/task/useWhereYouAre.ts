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

import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import { INBOX_CHANGED_EVENT } from '../inbox-data'
import type { RuntimeWorkflowDiagram, RuntimeWorkflowLiveStates } from '../api/types'
import { whereItems, type WhereData } from './where'

// Frozen recipes never change after creation: one fetch per runtime for the session,
// shared by every pane on that runtime.
const diagramCache = new Map<string, RuntimeWorkflowDiagram>()

// Spec §4: the steps of the (sub-)workflow holding this task. Loads only while the pane
// is on screen and online, and refreshes on the inbox push — no polling of its own
// (tablet battery). A failure says "unavailable"; it never breaks the task.
export function useWhereYouAre(instanceId: string, stepOid: string, enabled: boolean): WhereData {
  const [diagram, setDiagram] = useState<RuntimeWorkflowDiagram | null>(() => diagramCache.get(instanceId) ?? null)
  const [live, setLive] = useState<RuntimeWorkflowLiveStates | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let alive = true
    const load = () => {
      const cached = diagramCache.get(instanceId)
      const diagramP = cached
        ? Promise.resolve(cached)
        : api.runtimeDiagram(instanceId).then((d) => {
            diagramCache.set(instanceId, d)
            return d
          })
      Promise.all([diagramP, api.runtimeLiveStates(instanceId)]).then(
        ([d, l]) => {
          if (!alive) return
          setDiagram(d)
          setLive(l)
          setFailed(false)
        },
        () => {
          if (alive) setFailed(true)
        },
      )
    }
    load()
    window.addEventListener(INBOX_CHANGED_EVENT, load)
    return () => {
      alive = false
      window.removeEventListener(INBOX_CHANGED_EVENT, load)
    }
  }, [instanceId, enabled])

  return useMemo<WhereData>(() => {
    if (diagram && live) return { status: 'ready', items: whereItems(diagram.root, live.steps, stepOid) }
    return { status: enabled && !failed ? 'loading' : 'unavailable', items: [] }
  }, [diagram, live, failed, enabled, stepOid])
}
