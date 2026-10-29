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

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useWhereYouAre } from '../useWhereYouAre'
import { api } from '../../api/client'
import { INBOX_CHANGED_EVENT } from '../../inbox-data'
import { ROOT, liveStep } from './where-fixtures'
import type { RuntimeWorkflowDiagram, RuntimeWorkflowLiveStates } from '../../api/types'

vi.mock('../../api/client', () => ({ api: { runtimeDiagram: vi.fn(), runtimeLiveStates: vi.fn() } }))

const diagram = (instanceId: string): RuntimeWorkflowDiagram => ({
  instanceId,
  runtimeNumber: 2,
  runtimeLabel: 'MIX-20261009-0002',
  masterName: 'Batch Mix',
  root: ROOT,
})
const live = (instanceId: string): RuntimeWorkflowLiveStates => ({
  instanceId,
  status: 'running',
  steps: { weigh: liveStep('COMPLETED'), charge: liveStep('WAITING_USER') },
  childActive: {},
})

beforeEach(() => vi.clearAllMocks())

// Instance ids differ per test: the frozen-diagram cache is module-level by design.
describe('useWhereYouAre', () => {
  it('a background or offline pane fetches nothing and says unavailable', () => {
    const { result } = renderHook(() => useWhereYouAre('iA', 'charge', false))
    expect(api.runtimeDiagram).not.toHaveBeenCalled()
    expect(api.runtimeLiveStates).not.toHaveBeenCalled()
    expect(result.current.status).toBe('unavailable')
  })

  it('loads when on screen, refreshes live states on the inbox push, and fetches the frozen diagram once', async () => {
    vi.mocked(api.runtimeDiagram).mockResolvedValue(diagram('iB'))
    vi.mocked(api.runtimeLiveStates).mockResolvedValue(live('iB'))

    const { result } = renderHook(() => useWhereYouAre('iB', 'charge', true))
    expect(result.current.status).toBe('loading')
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.items.map((i) => i.name)).toEqual(['Weigh', 'Charge', 'Heat', 'Side note'])

    act(() => {
      window.dispatchEvent(new Event(INBOX_CHANGED_EVENT))
    })
    await waitFor(() => expect(api.runtimeLiveStates).toHaveBeenCalledTimes(2))
    expect(api.runtimeDiagram).toHaveBeenCalledTimes(1)
  })

  it('a failed load says unavailable instead of throwing', async () => {
    vi.mocked(api.runtimeDiagram).mockResolvedValue(diagram('iC'))
    vi.mocked(api.runtimeLiveStates).mockRejectedValue(new Error('HTTP 403'))

    const { result } = renderHook(() => useWhereYouAre('iC', 'charge', true))

    await waitFor(() => expect(result.current.status).toBe('unavailable'))
  })
})
