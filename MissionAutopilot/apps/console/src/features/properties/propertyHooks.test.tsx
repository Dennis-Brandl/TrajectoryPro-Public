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
 * The property mutations must seed the detail-query cache from the PUT
 * response, not merely invalidate it. Otherwise the editor, which drops
 * back to the cached specs the moment the save resolves, flashes the OLD
 * value until the background refetch lands (seen live on the Kitchen env).
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useUpdateEnvironmentProperties } from '@/features/environments/hooks'
import { useUpdateActionProperties } from '@/features/actions/hooks'

const updateEnvironmentProperties = vi.fn()
const updateActionProperties = vi.fn()

vi.mock('@/lib/api', () => ({
  api: {
    updateEnvironmentProperties: (...args: unknown[]) => updateEnvironmentProperties(...args),
    updateActionProperties: (...args: unknown[]) => updateActionProperties(...args),
  },
}))

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { queryClient, wrapper }
}

const oldSpecs = [{ name: 'Config', entries: [{ name: 'Host', value: 'localhost' }] }]
const newSpecs = [{ name: 'Config', entries: [{ name: 'Host', value: '10.0.0.5' }] }]

describe('useUpdateEnvironmentProperties', () => {
  it('seeds the environment detail cache from the response as soon as the save resolves', async () => {
    const { queryClient, wrapper } = setup()
    queryClient.setQueryData(['environments', 'env-1'], {
      oid: 'env-1',
      local_id: 'Kitchen',
      action_property_specifications: oldSpecs,
    })
    updateEnvironmentProperties.mockResolvedValue({
      oid: 'env-1',
      action_property_specifications: newSpecs,
    })

    const { result } = renderHook(() => useUpdateEnvironmentProperties(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({
        oid: 'env-1',
        edits: [{ property: 'Config', entry: 'Host', value: '10.0.0.5' }],
      })
    })

    expect(updateEnvironmentProperties).toHaveBeenCalledWith('env-1', [
      { property: 'Config', entry: 'Host', value: '10.0.0.5' },
    ])
    const cached = queryClient.getQueryData<{
      local_id: string
      action_property_specifications: unknown
    }>(['environments', 'env-1'])
    expect(cached?.action_property_specifications).toEqual(newSpecs)
    // Only the specs are replaced — the rest of the detail stays.
    expect(cached?.local_id).toBe('Kitchen')
  })
})

describe('useUpdateActionProperties', () => {
  it('seeds the action detail cache from the response as soon as the save resolves', async () => {
    const { queryClient, wrapper } = setup()
    queryClient.setQueryData(['actions', 'a1'], {
      oid: 'a1',
      local_id: 'BakeItem',
      property_specifications: oldSpecs,
    })
    updateActionProperties.mockResolvedValue({ oid: 'a1', property_specifications: newSpecs })

    const { result } = renderHook(() => useUpdateActionProperties(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({
        oid: 'a1',
        edits: [{ property: 'Config', entry: 'Host', value: '10.0.0.5' }],
      })
    })

    const cached = queryClient.getQueryData<{ local_id: string; property_specifications: unknown }>(
      ['actions', 'a1']
    )
    expect(cached?.property_specifications).toEqual(newSpecs)
    expect(cached?.local_id).toBe('BakeItem')
  })
})
