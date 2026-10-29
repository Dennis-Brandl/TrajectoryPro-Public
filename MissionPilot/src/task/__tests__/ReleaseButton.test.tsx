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
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ReleaseButton, releaseQuestion } from '../ReleaseButton'

afterEach(cleanup)

describe('ReleaseButton (spec §5.4)', () => {
  it('with nothing typed, one tap releases', () => {
    const onRelease = vi.fn()
    render(<ReleaseButton typedCount={0} onRelease={onRelease} />)
    fireEvent.click(screen.getByRole('button', { name: 'Release' }))
    expect(onRelease).toHaveBeenCalledTimes(1)
  })

  it('with typed values it asks first, focuses Keep, and Keep keeps', () => {
    const onRelease = vi.fn()
    render(<ReleaseButton typedCount={3} onRelease={onRelease} />)

    fireEvent.click(screen.getByRole('button', { name: 'Release' }))
    expect(screen.getByRole('alert').textContent).toBe('Release and discard 3 entered values?')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep' }))

    fireEvent.click(screen.getByRole('button', { name: 'Keep' }))
    expect(onRelease).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Release' }))
    fireEvent.click(screen.getByRole('button', { name: 'Release' }))
    expect(onRelease).toHaveBeenCalledTimes(1)
  })

  it('names a single value in the singular', () => {
    expect(releaseQuestion(1)).toBe('Release and discard 1 entered value?')
  })
})
