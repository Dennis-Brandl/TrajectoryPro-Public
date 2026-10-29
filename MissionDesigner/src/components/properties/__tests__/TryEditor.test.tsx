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

import { render, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { TryEditor } from '../TryEditor'

const catches = [{ catchId: 'OvenFailed' }, { catchId: 'OperatorAborted' }]

describe('TryEditor', () => {
  it('shows an add button and no rows when empty', () => {
    const { getByText, queryByRole } = render(<TryEditor value={[]} onChange={vi.fn()} availableCatches={catches} />)
    expect(getByText(/Add TRY/i)).toBeTruthy()
    expect(queryByRole('listitem')).toBeNull()
  })
  it('add appends a row with the first unused mode + first catch', () => {
    const onChange = vi.fn()
    const { getByText } = render(<TryEditor value={[]} onChange={onChange} availableCatches={catches} />)
    fireEvent.click(getByText(/Add TRY/i))
    expect(onChange).toHaveBeenCalledWith([{ mode: 'ERROR', catch_id: 'OvenFailed', release_on_catch: true }])
  })
  it('Add TRY button is disabled when availableCatches is empty', () => {
    const { getByRole } = render(<TryEditor value={[]} onChange={vi.fn()} availableCatches={[]} />)
    const btn = getByRole('button', { name: /Add TRY/i }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('toggling release_on_catch updates the row', () => {
    const onChange = vi.fn()
    const { getByRole } = render(
      <TryEditor
        value={[{ mode: 'ERROR', catch_id: 'OvenFailed', release_on_catch: true }]}
        onChange={onChange}
        availableCatches={catches}
      />,
    )
    fireEvent.click(getByRole('checkbox'))
    expect(onChange).toHaveBeenCalledWith([{ mode: 'ERROR', catch_id: 'OvenFailed', release_on_catch: false }])
  })

  it('shows the "TRY · error handling" heading by default', () => {
    const { getByText } = render(<TryEditor value={[]} onChange={vi.fn()} availableCatches={catches} />)
    expect(getByText(/TRY · error handling/i)).toBeTruthy()
  })

  it('hides the heading but keeps the add button when hideHeading is set', () => {
    const { queryByText, getByText } = render(
      <TryEditor value={[]} onChange={vi.fn()} availableCatches={catches} hideHeading />,
    )
    expect(queryByText(/TRY · error handling/i)).toBeNull()
    expect(getByText(/Add TRY/i)).toBeTruthy()
  })
})
