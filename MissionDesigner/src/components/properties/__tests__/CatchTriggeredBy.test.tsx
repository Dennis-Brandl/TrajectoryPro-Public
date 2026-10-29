// @vitest-environment jsdom
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

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CatchTriggeredBy } from '../CatchTriggeredBy'
import type { CatchTrigger } from '@/lib/canvas/findCatchTriggers'

const triggers: CatchTrigger[] = [
  { stepId: 's1', stepLabel: 'Pump Start', mode: 'ERROR' },
  { stepId: 's2', stepLabel: 'Valve Open', mode: 'ABORT' },
]

describe('CatchTriggeredBy', () => {
  it('renders a row per trigger with the mode badge', () => {
    render(<CatchTriggeredBy triggers={triggers} onSelect={() => {}} />)
    expect(screen.getByText('Triggered by (2)')).toBeTruthy()
    expect(screen.getByText('Pump Start')).toBeTruthy()
    expect(screen.getByText('ON ERROR')).toBeTruthy()
    expect(screen.getByText('Valve Open')).toBeTruthy()
    expect(screen.getByText('ON ABORT')).toBeTruthy()
  })

  it('shows the empty-state hint when there are no triggers', () => {
    render(<CatchTriggeredBy triggers={[]} onSelect={() => {}} />)
    expect(screen.getByText('Triggered by (0)')).toBeTruthy()
    expect(screen.getByText('Not referenced by any TRY')).toBeTruthy()
  })

  it('calls onSelect with the step id when a row is clicked', () => {
    const onSelect = vi.fn()
    render(<CatchTriggeredBy triggers={triggers} onSelect={onSelect} />)
    fireEvent.click(screen.getByText('Pump Start'))
    expect(onSelect).toHaveBeenCalledWith('s1')
  })
})
