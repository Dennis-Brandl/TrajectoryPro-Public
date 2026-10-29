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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { StateTimeline } from './StateTimeline'

describe('StateTimeline', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-14T00:00:30Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders nothing when history is empty', () => {
    const { container } = render(
      <StateTimeline history={[]} terminal={false} />
    )
    expect(container.textContent).toBe('')
  })

  it('renders one pill per history entry', () => {
    render(
      <StateTimeline
        history={[
          { state: 'STARTING', entered_at: '2026-05-14T00:00:00Z', duration_ms: 5000 },
          { state: 'EXECUTING', entered_at: '2026-05-14T00:00:05Z' },
        ]}
        terminal={false}
      />
    )
    expect(screen.getByText('STARTING')).toBeInTheDocument()
    expect(screen.getByText('EXECUTING')).toBeInTheDocument()
  })

  it('shows finalized duration on completed entries', () => {
    render(
      <StateTimeline
        history={[
          { state: 'STARTING', entered_at: '2026-05-14T00:00:00Z', duration_ms: 5000 },
          { state: 'EXECUTING', entered_at: '2026-05-14T00:00:05Z' },
        ]}
        terminal={false}
      />
    )
    expect(screen.getByText('5.0s')).toBeInTheDocument()
  })

  it('ticks the current pill while !terminal', () => {
    render(
      <StateTimeline
        history={[{ state: 'EXECUTING', entered_at: '2026-05-14T00:00:00Z' }]}
        terminal={false}
      />
    )
    // System time is T+30s. Current pill should show ~30s.
    expect(screen.getByText('30.0s')).toBeInTheDocument()

    // Advance another second — single advanceTimersByTime moves Date.now and
    // fires the interval together (don't combine with setSystemTime or the
    // clock jumps twice).
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByText('31.0s')).toBeInTheDocument()
  })

  it('shows accurate elapsed time for an instance that started before mount', () => {
    // Simulate: tester opens an InstancePanel for an instance that was
    // invoked 5 minutes ago and is still in EXECUTING.
    render(
      <StateTimeline
        history={[
          { state: 'STARTING', entered_at: '2026-05-13T23:55:00Z', duration_ms: 5_000 },
          { state: 'EXECUTING', entered_at: '2026-05-13T23:55:05Z' },
        ]}
        terminal={false}
      />
    )
    // EXECUTING entered at T-(5min 25s), current Date.now() is 2026-05-14T00:00:30Z.
    // Elapsed = 5 min 25 s = 325s → "325.0s"
    expect(screen.getByText('325.0s')).toBeInTheDocument()
  })

  it('stops ticking when terminal=true', () => {
    render(
      <StateTimeline
        history={[
          { state: 'EXECUTING', entered_at: '2026-05-14T00:00:00Z', duration_ms: 30_000 },
          { state: 'COMPLETED', entered_at: '2026-05-14T00:00:30Z' },
        ]}
        terminal={true}
      />
    )

    // System time would advance for a non-terminal pill, but terminal=true
    // means no setInterval is installed, so no re-render happens. The
    // COMPLETED entry has no duration_ms (current state), but since it isLast
    // AND terminal=true, the displayed duration freezes at the initial render
    // value (now - entered_at at mount = 0s).
    act(() => {
      vi.advanceTimersByTime(30_000)
    })

    expect(screen.getByText('COMPLETED')).toBeInTheDocument()
  })

  it('invokes onSelectState on click with the entry state and index', () => {
    const onSelect = vi.fn()
    render(
      <StateTimeline
        history={[
          { state: 'STARTING', entered_at: '2026-05-14T00:00:00Z', duration_ms: 5000 },
          { state: 'EXECUTING', entered_at: '2026-05-14T00:00:05Z' },
        ]}
        terminal={false}
        onSelectState={onSelect}
      />
    )
    fireEvent.click(screen.getByText('STARTING'))
    expect(onSelect).toHaveBeenCalledWith('STARTING', 0)
  })
})
