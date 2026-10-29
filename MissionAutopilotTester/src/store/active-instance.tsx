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

import { createContext, useCallback, useContext, useMemo, useReducer, type ReactNode } from 'react'

export interface TrackedInstance {
  instance_id: string
  connection_id: string
  action_oid: string
  invoked_at: string
  last_known_state?: string
  last_known_error?: string | null
}

export type Selection =
  | { type: 'action'; action_oid: string }
  | { type: 'instance'; instance_id: string }
  | null

export interface ActiveInstanceState {
  selection: Selection
  trackedInstances: TrackedInstance[]
}

export type ActiveInstanceAction =
  | { type: 'selectAction'; action_oid: string }
  | { type: 'selectInstance'; instance_id: string }
  | { type: 'clearSelection' }
  | { type: 'trackInstance'; instance: TrackedInstance }
  | {
      type: 'updateTrackedInstance'
      instance_id: string
      patch: Partial<Omit<TrackedInstance, 'instance_id' | 'connection_id' | 'action_oid' | 'invoked_at'>>
    }

const INITIAL_STATE: ActiveInstanceState = { selection: null, trackedInstances: [] }

const PER_CONNECTION_CAP = 50

export function activeInstanceReducer(
  state: ActiveInstanceState,
  action: ActiveInstanceAction
): ActiveInstanceState {
  switch (action.type) {
    case 'selectAction':
      return { ...state, selection: { type: 'action', action_oid: action.action_oid } }
    case 'selectInstance':
      return { ...state, selection: { type: 'instance', instance_id: action.instance_id } }
    case 'clearSelection':
      return { ...state, selection: null }
    case 'trackInstance': {
      const incoming = action.instance
      const prepended = [incoming, ...state.trackedInstances]
      const sameConn = prepended.filter((t) => t.connection_id === incoming.connection_id)
      if (sameConn.length <= PER_CONNECTION_CAP) {
        return { ...state, trackedInstances: prepended }
      }
      const keepIds = new Set(sameConn.slice(0, PER_CONNECTION_CAP).map((t) => t.instance_id))
      const filtered = prepended.filter(
        (t) => t.connection_id !== incoming.connection_id || keepIds.has(t.instance_id)
      )
      return { ...state, trackedInstances: filtered }
    }
    case 'updateTrackedInstance': {
      const idx = state.trackedInstances.findIndex((t) => t.instance_id === action.instance_id)
      if (idx === -1) return state
      const updated = { ...state.trackedInstances[idx], ...action.patch }
      const list = [...state.trackedInstances]
      list[idx] = updated
      return { ...state, trackedInstances: list }
    }
    default: {
      const _exhaustive: never = action
      void _exhaustive
      return state
    }
  }
}

export interface ActiveInstanceApi {
  state: ActiveInstanceState
  selectAction: (action_oid: string) => void
  selectInstance: (instance_id: string) => void
  clearSelection: () => void
  trackInstance: (
    instance: Omit<TrackedInstance, 'invoked_at'> & { invoked_at?: string }
  ) => TrackedInstance
  updateTrackedInstance: (
    instance_id: string,
    patch: Partial<Omit<TrackedInstance, 'instance_id' | 'connection_id' | 'action_oid' | 'invoked_at'>>
  ) => void
}

const ActiveInstanceContext = createContext<ActiveInstanceApi | null>(null)

export function ActiveInstanceProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(activeInstanceReducer, INITIAL_STATE)

  const selectAction = useCallback<ActiveInstanceApi['selectAction']>((action_oid) => {
    dispatch({ type: 'selectAction', action_oid })
  }, [])

  const selectInstance = useCallback<ActiveInstanceApi['selectInstance']>((instance_id) => {
    dispatch({ type: 'selectInstance', instance_id })
  }, [])

  const clearSelection = useCallback<ActiveInstanceApi['clearSelection']>(() => {
    dispatch({ type: 'clearSelection' })
  }, [])

  const trackInstance = useCallback<ActiveInstanceApi['trackInstance']>((instance) => {
    const full: TrackedInstance = {
      ...instance,
      invoked_at: instance.invoked_at ?? new Date().toISOString(),
    }
    dispatch({ type: 'trackInstance', instance: full })
    return full
  }, [])

  const updateTrackedInstance = useCallback<ActiveInstanceApi['updateTrackedInstance']>(
    (instance_id, patch) => {
      dispatch({ type: 'updateTrackedInstance', instance_id, patch })
    },
    []
  )

  const value = useMemo<ActiveInstanceApi>(
    () => ({
      state,
      selectAction,
      selectInstance,
      clearSelection,
      trackInstance,
      updateTrackedInstance,
    }),
    [state, selectAction, selectInstance, clearSelection, trackInstance, updateTrackedInstance]
  )

  return <ActiveInstanceContext.Provider value={value}>{children}</ActiveInstanceContext.Provider>
}

// Co-located with the provider above to keep all active-instance API surface in one module.
// Splitting into a separate file just to satisfy this lint rule would obscure the boundary.
// eslint-disable-next-line react-refresh/only-export-components
export function useActiveInstance(): ActiveInstanceApi {
  const ctx = useContext(ActiveInstanceContext)
  if (!ctx) {
    throw new Error('useActiveInstance must be used within an ActiveInstanceProvider')
  }
  return ctx
}

// Co-located with the provider above to keep all active-instance API surface in one module.
// Splitting into a separate file just to satisfy this lint rule would obscure the boundary.
// eslint-disable-next-line react-refresh/only-export-components
export function useTrackedInstances(connection_id: string | undefined | null): TrackedInstance[] {
  const { state } = useActiveInstance()
  if (!connection_id) return []
  return state.trackedInstances.filter((t) => t.connection_id === connection_id)
}
