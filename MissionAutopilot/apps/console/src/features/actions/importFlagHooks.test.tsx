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

/**
 * Cache discipline for the import-flag mutations and the upload mutation:
 *   - resolving a flag seeds the action detail cache from the response
 *     (same lesson as the property edits: refetch-only flashes stale data)
 *     and invalidates the environment queries that list the flag;
 *   - deleting an action drops its detail cache and invalidates the lists;
 *   - an upload invalidates action + code queries too, so an open Action page
 *     cannot keep showing pre-import specs or a cleared flag.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useResolveSignatureChange, useDeleteAction } from '@/features/actions/hooks'
import { useUploadPackage } from '@/features/environments/hooks'

const resolveSignatureChange = vi.fn()
const deleteAction = vi.fn()
const upload = vi.fn()

vi.mock('@/lib/api', () => ({
  api: {
    resolveSignatureChange: (...args: unknown[]) => resolveSignatureChange(...args),
    deleteAction: (...args: unknown[]) => deleteAction(...args),
    upload: (...args: unknown[]) => upload(...args),
  },
}))

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { queryClient, invalidate, wrapper }
}

const flag = {
  flagged_at: '2026-09-02T10:00:00.000Z',
  baseline_input_parameter_specifications: [],
  baseline_output_parameter_specifications: [],
  changes: ['input `count` removed'],
}

describe('useResolveSignatureChange', () => {
  it('clears the flag in the action detail cache and invalidates the environment queries', async () => {
    const { queryClient, invalidate, wrapper } = setup()
    queryClient.setQueryData(['actions', 'a1'], { oid: 'a1', signature_change: flag })
    resolveSignatureChange.mockResolvedValue({ oid: 'a1', signature_change: null })

    const { result } = renderHook(() => useResolveSignatureChange(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync('a1')
    })

    expect(resolveSignatureChange).toHaveBeenCalledWith('a1')
    expect(queryClient.getQueryData(['actions', 'a1'])).toEqual({
      oid: 'a1',
      signature_change: null,
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['environments'] })
  })
})

describe('useDeleteAction', () => {
  it('drops the action detail cache and invalidates the environment and tree queries', async () => {
    const { queryClient, invalidate, wrapper } = setup()
    queryClient.setQueryData(['actions', 'a1'], { oid: 'a1' })
    deleteAction.mockResolvedValue({ deleted: true, action_oid: 'a1' })

    const { result } = renderHook(() => useDeleteAction(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync('a1')
    })

    expect(deleteAction).toHaveBeenCalledWith('a1')
    expect(queryClient.getQueryData(['actions', 'a1'])).toBeUndefined()
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['environments'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['explorer-tree'] })
  })
})

describe('useUploadPackage', () => {
  it('invalidates environments, actions, code and the explorer tree after an upload', async () => {
    const { invalidate, wrapper } = setup()
    upload.mockResolvedValue({ imported: [], errors: [] })

    const { result } = renderHook(() => useUploadPackage(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync(new File(['{}'], 'Env.WFenvir'))
    })

    for (const key of ['environments', 'actions', 'code', 'explorer-tree']) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: [key] })
    }
  })
})

describe('useDeleteAction while the detail is still observed', () => {
  it('does not remove an observed detail query (the page navigates away itself)', async () => {
    const { wrapper } = setup()
    deleteAction.mockResolvedValue({ deleted: true, action_oid: 'a1' })
    const queryFn = vi.fn().mockResolvedValue({ oid: 'a1' })

    const { result } = renderHook(
      () => ({
        detail: useQuery({ queryKey: ['actions', 'a1'], queryFn }),
        remove: useDeleteAction(),
      }),
      { wrapper }
    )
    await waitFor(() => expect(result.current.detail.data).toEqual({ oid: 'a1' }))

    await act(async () => {
      await result.current.remove.mutateAsync('a1')
    })

    // Removing an observed query would drop the page's data and refetch it: a 404 flash.
    expect(result.current.detail.data).toEqual({ oid: 'a1' })
    expect(queryFn).toHaveBeenCalledTimes(1)
  })
})
