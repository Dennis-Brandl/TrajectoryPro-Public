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

import { useEffect, useMemo, useReducer, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchInstance } from '../api/instances'
import type {
  Instance,
  InstanceLiveState,
  SseEventWire,
  SseEventType,
} from '../api/types'
import { useActiveConnection } from './connections'
import { useActiveInstance } from './active-instance'
import {
  initialStateFromInstance,
  instanceStreamReducer,
} from './instance-stream-reducer'

export interface UseInstanceStreamResult {
  data: InstanceLiveState | undefined
  isLoading: boolean
  isError: boolean
  error: Error | null
  isConnected: boolean
}

type Action =
  | { type: 'reset' }
  | { type: 'seed'; instance: Instance }
  | { type: 'event'; event: SseEventWire }

function streamReducer(
  state: InstanceLiveState | undefined,
  action: Action
): InstanceLiveState | undefined {
  if (action.type === 'reset') return undefined
  if (action.type === 'seed') return initialStateFromInstance(action.instance)
  if (!state) return state
  return instanceStreamReducer(state, action.event)
}

const SSE_EVENT_TYPES: readonly SseEventType[] = ['state_change', 'output', 'log', 'heartbeat']

export function useInstanceStream(instanceId: string | null): UseInstanceStreamResult {
  const connection = useActiveConnection()
  const { updateTrackedInstance } = useActiveInstance()

  const query = useQuery<Instance, Error>({
    queryKey: ['instance-seed', connection?.id, instanceId],
    queryFn: () => {
      if (!connection || !instanceId) throw new Error('No active connection or instance id')
      return fetchInstance(connection, instanceId)
    },
    enabled: connection !== null && instanceId !== null,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  })

  const [liveState, dispatch] = useReducer(streamReducer, undefined)
  const [isConnected, setIsConnected] = useState(false)

  // Reset live state whenever the target instance changes (including → null).
  // Runs before the seed effect on the same render, so seed for the new id wins.
  useEffect(() => {
    dispatch({ type: 'reset' })
    setIsConnected(false)
  }, [instanceId, connection?.id])

  // Seed once REST resolves for the current target. Source-ordered before the
  // EventSource effect below, so the reducer is initialized before any event
  // dispatch can arrive (React processes dispatches in queue order; the seed
  // is always enqueued first).
  useEffect(() => {
    if (!query.isSuccess || !query.data) return
    if (query.data.instance_id !== instanceId) return
    dispatch({ type: 'seed', instance: query.data })
  }, [query.isSuccess, query.data, instanceId])

  // Open EventSource as soon as we have data for the current target — keyed on
  // the REST data identity rather than waiting for the reducer's seed dispatch
  // to commit. Saves one render of latency before live updates start.
  useEffect(() => {
    if (!connection || !instanceId) return
    if (!query.data || query.data.instance_id !== instanceId) return

    const baseUrl = connection.url.replace(/\/+$/, '')
    const tokenParam = connection.apiKey ? `?token=${encodeURIComponent(connection.apiKey)}` : ''
    const url = `${baseUrl}/trajectory/v1/instances/${instanceId}/events${tokenParam}`

    const es = new EventSource(url)
    const onOpen = () => setIsConnected(true)
    const onError = () => setIsConnected(false)
    const handlers: Array<{ type: string; fn: (e: MessageEvent) => void }> = []

    es.onopen = onOpen
    es.onerror = onError

    for (const type of SSE_EVENT_TYPES) {
      const fn = (e: MessageEvent) => {
        let parsed: SseEventWire['data']
        try {
          parsed = JSON.parse(e.data) as SseEventWire['data']
        } catch {
          return
        }
        const id = Number(e.lastEventId)
        if (!Number.isFinite(id)) return
        dispatch({
          type: 'event',
          event: { id, type, data: parsed } as SseEventWire,
        })
      }
      es.addEventListener(type, fn as EventListener)
      handlers.push({ type, fn })
    }

    return () => {
      for (const h of handlers) {
        es.removeEventListener(h.type, h.fn as EventListener)
      }
      es.close()
      setIsConnected(false)
    }
  }, [connection?.id, connection?.url, connection?.apiKey, instanceId, query.data])

  // Push state into the tracker for InstanceList highlighting.
  useEffect(() => {
    if (!liveState) return
    updateTrackedInstance(liveState.instance_id, {
      last_known_state: liveState.current_state,
      last_known_error: liveState.terminal_error,
    })
  }, [liveState?.instance_id, liveState?.current_state, liveState?.terminal_error, updateTrackedInstance])

  // Fallback derived synchronously from the REST seed so consumers don't see a
  // one-render gap where isLoading=true after query.isSuccess but before the
  // seed effect dispatches. Once the reducer's liveState catches up (and after
  // SSE events accumulate on top), liveState wins.
  const fallback = useMemo(
    () =>
      query.data && query.data.instance_id === instanceId
        ? initialStateFromInstance(query.data)
        : undefined,
    [query.data, instanceId]
  )

  const effective =
    liveState && liveState.instance_id === instanceId ? liveState : fallback

  return {
    data: effective,
    isLoading: instanceId !== null && !effective && !query.isError,
    isError: query.isError,
    error: query.error ?? null,
    isConnected,
  }
}
