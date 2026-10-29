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

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { api } from '@/lib/api'
import { triggerDownload } from '@/lib/download'
import type { EnvironmentDetail, PropertyEdit } from '@/lib/types'

export function useEnvironments() {
  return useQuery({
    queryKey: ['environments'],
    queryFn: () => api.environments(),
  })
}

export function useEnvironment(oid: string) {
  return useQuery({
    queryKey: ['environments', oid],
    queryFn: () => api.environment(oid),
    enabled: !!oid,
  })
}

export function useUploadPackage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (file: File) => api.upload([file]),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['environments'] })
      // A re-import rewrites action specs and can set or clear import flags:
      // an open Action page or code editor must not keep pre-import data.
      void queryClient.invalidateQueries({ queryKey: ['actions'] })
      void queryClient.invalidateQueries({ queryKey: ['code'] })
      void queryClient.invalidateQueries({ queryKey: ['explorer-tree'] })
    },
  })
}

export function useUpdateEnvironmentProperties() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ oid, edits }: { oid: string; edits: PropertyEdit[] }) =>
      api.updateEnvironmentProperties(oid, edits),
    onSuccess: (data, variables) => {
      // Seed the detail cache from the response FIRST: the editor drops back
      // to the cached specs the moment the save resolves, so relying on the
      // background refetch alone flashes the old value.
      queryClient.setQueryData<EnvironmentDetail>(['environments', variables.oid], (old) =>
        old ? { ...old, action_property_specifications: data.action_property_specifications } : old
      )
      void queryClient.invalidateQueries({ queryKey: ['environments', variables.oid] })
      // The environments list carries the specs too.
      void queryClient.invalidateQueries({ queryKey: ['environments'], exact: true })
    },
  })
}

export function useDeleteEnvironment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (oid: string) => api.deleteEnvironment(oid),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['environments'] })
      void queryClient.invalidateQueries({ queryKey: ['explorer-tree'] })
    },
  })
}

export function useExportEnvironment(oid: string, localId: string) {
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const run = useCallback(async () => {
    setIsPending(true)
    setError(null)
    try {
      const blob = await api.exportEnvironmentBundle(oid)
      triggerDownload(blob, `${localId}.WFenvirBundleX`)
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      setError(e)
      throw e
    } finally {
      setIsPending(false)
    }
  }, [oid, localId])

  return { run, isPending, error }
}

export function useExportEnvironmentEnvirX(oid: string, localId: string) {
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const run = useCallback(async () => {
    setIsPending(true)
    setError(null)
    try {
      const blob = await api.exportEnvironmentEnvirX(oid)
      triggerDownload(blob, `${localId}.WFenvirX`)
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      setError(e)
      throw e
    } finally {
      setIsPending(false)
    }
  }, [oid, localId])

  return { run, isPending, error }
}

export function useGenerateEnvironmentReport(oid: string, localId: string) {
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const run = useCallback(async () => {
    setIsPending(true)
    setError(null)
    try {
      const blob = await api.exportEnvironmentBundle(oid)

      // Lazy-load the heavy modules
      const [{ parseEnvirBundle }, { generateEnvironmentReportPDF }] = await Promise.all([
        import('@/lib/envir-bundle'),
        import('@/lib/pdf/environment-report'),
      ])

      const bundle = await parseEnvirBundle(blob)
      const pdfBlob = generateEnvironmentReportPDF(bundle)
      triggerDownload(pdfBlob, `${localId}-report.pdf`)
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
      throw err
    } finally {
      setIsPending(false)
    }
  }, [oid, localId])

  return { run, isPending, error }
}
