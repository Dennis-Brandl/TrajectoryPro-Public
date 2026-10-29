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

import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { CatchOutputsList } from '../CatchOutputsList'

describe('CatchOutputsList', () => {
  it('always renders the four canonical outputs with descriptions, with no editable controls', () => {
    const { container } = render(<CatchOutputsList outputs={[]} />)
    for (const name of ['Message', 'Reason', 'Step', 'StepID']) {
      expect(screen.getByText(name)).toBeTruthy()
    }
    expect(screen.getByText(/Failure mode that fired/)).toBeTruthy()
    expect(container.querySelectorAll('button').length).toBe(0)
    expect(container.querySelectorAll('input').length).toBe(0)
  })

  it('backfills missing canonical rows and displays them in canonical order', () => {
    const { container } = render(<CatchOutputsList outputs={[{ id: 'x1', name: 'Reason' }]} />)
    const names = [...container.querySelectorAll('div.font-medium')].map((el) => el.textContent)
    expect(names).toEqual(['Message', 'Reason', 'Step', 'StepID'])
  })

  it('lists non-canonical stray rows after the canonical four', () => {
    const { container } = render(<CatchOutputsList outputs={[{ id: 'x1', name: 'Custom' }]} />)
    const names = [...container.querySelectorAll('div.font-medium')].map((el) => el.textContent)
    expect(names).toEqual(['Message', 'Reason', 'Step', 'StepID', 'Custom'])
  })

  it('shows an explicitly bound target read-only', () => {
    render(<CatchOutputsList outputs={[{ id: 'x1', name: 'Message', target: 'Catch.Message' }]} />)
    expect(screen.getByText(/Catch\.Message/)).toBeTruthy()
  })
})
