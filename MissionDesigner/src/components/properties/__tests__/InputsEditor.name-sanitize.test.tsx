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

// Deferred final-review ticket (2026-08-11): parameter names travel as {{Name}} tokens and
// as HTML-attribute values in the content editor's chips, so the braces and HTML-special
// characters must be rejected at the source alongside whitespace.
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { InputsEditor } from '../InputsEditor'

describe('InputsEditor name sanitization', () => {
  it('strips whitespace, token braces, and HTML-special characters from typed names', () => {
    const onChange = vi.fn()
    render(<InputsEditor inputs={[{ id: 'p1', name: '', description: '' }]} onChange={onChange} nameOnly />)
    fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'Q&A {x} <y> "z" ok' } })
    expect(onChange).toHaveBeenCalledWith([{ id: 'p1', name: 'QAxyzok', description: '' }])
  })
})
