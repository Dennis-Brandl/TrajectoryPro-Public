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

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TextInput } from './TextInput'

describe('TextInput', () => {
  it('associates the label with the input via for/id', () => {
    render(<TextInput label="Server URL" defaultValue="" />)
    const input = screen.getByLabelText('Server URL')
    expect(input).toBeInTheDocument()
    expect(input.tagName).toBe('INPUT')
  })

  it('respects an explicit id', () => {
    render(<TextInput id="my-id" label="Name" />)
    expect(screen.getByLabelText('Name').id).toBe('my-id')
  })

  it('fires onChange when typing', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<TextInput label="URL" onChange={onChange} />)
    await user.type(screen.getByLabelText('URL'), 'http')
    expect(onChange).toHaveBeenCalled()
  })

  it('renders helper text when provided and no error', () => {
    render(<TextInput label="URL" helper="e.g. http://localhost:3000" />)
    expect(screen.getByText('e.g. http://localhost:3000')).toBeInTheDocument()
  })

  it('renders error text in place of helper when error is set', () => {
    render(<TextInput label="URL" helper="hint" error="Invalid URL" />)
    expect(screen.queryByText('hint')).not.toBeInTheDocument()
    expect(screen.getByText('Invalid URL')).toBeInTheDocument()
  })

  it('applies aria-invalid when error is set', () => {
    render(<TextInput label="URL" error="bad" />)
    expect(screen.getByLabelText('URL')).toHaveAttribute('aria-invalid', 'true')
  })
})
