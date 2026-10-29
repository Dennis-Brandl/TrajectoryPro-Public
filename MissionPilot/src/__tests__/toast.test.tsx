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

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, act, cleanup } from '@testing-library/react'
import { Toasts, useToast, type UseToastResult } from '../toast'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function Shower({ onReady }: { onReady(show: UseToastResult['show']): void }) {
  onReady(useToast().show)
  return null
}

function mount(): UseToastResult['show'] {
  let show: UseToastResult['show'] | undefined
  render(
    <>
      <Toasts />
      <Shower onReady={(s) => (show = s)} />
    </>,
  )
  return (text, opts) => show!(text, opts)
}

describe('toasts', () => {
  it('an ok toast carries the ok style and stays 6 s (spec §5.6 item 1)', () => {
    vi.useFakeTimers()
    const show = mount()
    act(() => show('Submitted X', { tone: 'ok' }))
    expect(screen.getByText('Submitted X').className).toBe('toast toast-ok')
    act(() => {
      vi.advanceTimersByTime(5500)
    })
    expect(screen.queryByText('Submitted X')).toBeTruthy()
    act(() => {
      vi.advanceTimersByTime(600)
    })
    expect(screen.queryByText('Submitted X')).toBeNull()
  })

  it('a routine toast keeps the plain style and 5 s', () => {
    vi.useFakeTimers()
    const show = mount()
    act(() => show('Plain'))
    expect(screen.getByText('Plain').className).toBe('toast')
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(screen.queryByText('Plain')).toBeNull()
  })
})
