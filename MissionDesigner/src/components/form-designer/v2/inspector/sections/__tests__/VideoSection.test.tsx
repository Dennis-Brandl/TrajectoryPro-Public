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
import { VideoSection } from '../VideoSection'
import type { VideoBlock } from '@mission/form-schema'

const block: VideoBlock = { id: 'b', type: 'video', src: 'https://example.com/a.mp4' }

describe('VideoSection', () => {
  it('edits src', () => {
    const onUpdate = vi.fn()
    render(<VideoSection block={block} onUpdate={onUpdate} />)
    fireEvent.change(screen.getByLabelText(/video url/i), { target: { value: 'https://example.com/b.mp4' } })
    expect(onUpdate).toHaveBeenCalledWith({ src: 'https://example.com/b.mp4' })
  })

  it('edits posterUrl', () => {
    const onUpdate = vi.fn()
    render(<VideoSection block={block} onUpdate={onUpdate} />)
    fireEvent.change(screen.getByLabelText(/poster/i), { target: { value: 'https://example.com/p.jpg' } })
    expect(onUpdate).toHaveBeenCalledWith({ posterUrl: 'https://example.com/p.jpg' })
  })
})
