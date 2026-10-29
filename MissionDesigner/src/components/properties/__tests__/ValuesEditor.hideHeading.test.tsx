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
import { describe, it, expect, vi } from 'vitest'
import { ValuesEditor } from '../ValuesEditor'

describe('ValuesEditor hideHeading', () => {
  it('renders the default "Value Properties" heading by default', () => {
    render(<ValuesEditor values={[]} onChange={vi.fn()} />)
    expect(screen.getByText('Value Properties')).toBeTruthy()
  })

  it('hides the heading when hideHeading is set', () => {
    render(<ValuesEditor values={[]} onChange={vi.fn()} hideHeading />)
    expect(screen.queryByText('Value Properties')).toBeNull()
    // The Add control must survive heading removal.
    expect(screen.getByRole('button', { name: /add value property/i })).toBeTruthy()
  })
})
