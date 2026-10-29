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

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { ActionDetail, PropertyEdit } from '@/lib/types'

export function useAction(oid: string) {
  return useQuery({
    queryKey: ['actions', oid],
    queryFn: () => api.action(oid),
    enabled: !!oid,
  })
}

export function useUpdateActionTimeout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ oid, timeout_seconds }: { oid: string; timeout_seconds: number | null }) =>
      api.updateActionTimeout(oid, timeout_seconds),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['actions', variables.oid] })
    },
  })
}

export function useUpdateActionProperties() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ oid, edits }: { oid: string; edits: PropertyEdit[] }) =>
      api.updateActionProperties(oid, edits),
    onSuccess: (data, variables) => {
      // Seed the detail cache from the response first — see the environment
      // hook for why relying on the refetch alone flashes the old value.
      queryClient.setQueryData<ActionDetail>(['actions', variables.oid], (old) =>
        old ? { ...old, property_specifications: data.property_specifications } : old
      )
      void queryClient.invalidateQueries({ queryKey: ['actions', variables.oid] })
    },
  })
}

export function useResolveSignatureChange() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (oid: string) => api.resolveSignatureChange(oid),
    onSuccess: (data, oid) => {
      // Seed the detail cache first (see useUpdateActionProperties), then let
      // the environment queries that list the flag refetch.
      queryClient.setQueryData<ActionDetail>(['actions', oid], (old) =>
        old ? { ...old, signature_change: data.signature_change } : old
      )
      void queryClient.invalidateQueries({ queryKey: ['actions', oid] })
      void queryClient.invalidateQueries({ queryKey: ['environments'] })
    },
  })
}

export function useDeleteAction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (oid: string) => api.deleteAction(oid),
    onSuccess: (_data, oid) => {
      queryClient.removeQueries({ queryKey: ['actions', oid] })
      void queryClient.invalidateQueries({ queryKey: ['environments'] })
      void queryClient.invalidateQueries({ queryKey: ['explorer-tree'] })
    },
  })
}

export function useClearCode() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ actionOid, state }: { actionOid: string; state: string }) =>
      api.clearCode(actionOid, state),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: ['code', variables.actionOid, variables.state],
      })
      void queryClient.invalidateQueries({
        queryKey: ['code', variables.actionOid, variables.state, 'active'],
      })
      void queryClient.invalidateQueries({ queryKey: ['explorer-tree'] })
      void queryClient.invalidateQueries({ queryKey: ['environments'] })
      void queryClient.invalidateQueries({ queryKey: ['actions', variables.actionOid] })
    },
  })
}
