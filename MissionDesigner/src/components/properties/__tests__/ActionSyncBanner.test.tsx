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

// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ActionSyncBanner } from '../ActionSyncBanner'
import type { ActionSyncState } from '@/lib/action-proxy/sync-state'

const outdated: ActionSyncState = {
  status: 'outdated',
  diff: {
    inputs: { added: ['time'], removed: [], changed: ['temp'] },
    outputs: { added: [], removed: ['old'], changed: [] },
  },
  merged: {
    inputs: [
      { id: 'a', name: 'time' },
      { id: 'b', name: 'temp' },
    ],
    outputs: [],
  },
}

describe('ActionSyncBanner (spec 2026-09-04 §6.4.2)', () => {
  it('renders nothing unless outdated', () => {
    for (const status of ['n/a', 'unresolved', 'synced'] as const) {
      const { container, unmount } = render(
        <ActionSyncBanner state={{ status, diff: null, merged: null }} onApply={vi.fn()} />,
      )
      expect(container.firstChild).toBeNull()
      unmount()
    }
  })

  it('shows the copy, the summary and applies the merged signature on click', () => {
    const onApply = vi.fn()
    render(<ActionSyncBanner state={outdated} onApply={onApply} />)
    expect(screen.getByText("The action's definition changed since this step was configured.")).toBeTruthy()
    expect(screen.getByText('Inputs: +1 ~1 · Outputs: −1')).toBeTruthy()
    fireEvent.click(screen.getByTestId('action-sync-update'))
    expect(onApply).toHaveBeenCalledWith(outdated.merged)
  })
})
