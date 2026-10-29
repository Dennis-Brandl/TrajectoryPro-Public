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
import { AppearanceSection } from '../AppearanceSection'
import type { TextBlock, TextInputBlock, DividerBlock } from '@mission/form-schema'

describe('AppearanceSection', () => {
  it('text/header render no appearance controls (moved to the content editor dialog)', () => {
    const { container } = render(
      <AppearanceSection block={{ id: 'b', type: 'text', content: 'hi' } as TextBlock} onUpdate={vi.fn()} />,
    )
    expect(container.querySelectorAll('select, button, input')).toHaveLength(0)
  })

  it('textInput keeps its size control', () => {
    const onUpdate = vi.fn()
    render(
      <AppearanceSection
        block={{ id: 'b', type: 'textInput', fieldName: 'f', size: 'md' } as TextInputBlock}
        onUpdate={onUpdate}
      />,
    )
    fireEvent.change(screen.getByLabelText(/size/i), { target: { value: 'xl' } })
    expect(onUpdate).toHaveBeenCalledWith({ size: 'xl' })
  })

  it('divider keeps its color and weight controls', () => {
    const onUpdate = vi.fn()
    render(<AppearanceSection block={{ id: 'b', type: 'divider' } as DividerBlock} onUpdate={onUpdate} />)
    fireEvent.change(screen.getByLabelText(/weight/i), { target: { value: 'thick' } })
    expect(onUpdate).toHaveBeenCalledWith({ weight: 'thick' })
  })
})
