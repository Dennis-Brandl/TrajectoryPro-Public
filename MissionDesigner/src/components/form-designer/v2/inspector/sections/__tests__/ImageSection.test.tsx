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
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ImageSection } from '../ImageSection'
import type { ImageBlock } from '@mission/form-schema'

const block: ImageBlock = { id: 'b', type: 'image', src: 'logo.png', objectFit: 'contain' }

describe('ImageSection', () => {
  it('edits objectFit and never touches aspectRatio', () => {
    const onUpdate = vi.fn()
    render(<ImageSection block={block} onUpdate={onUpdate} />)
    fireEvent.change(screen.getByLabelText(/fit/i), { target: { value: 'cover' } })
    expect(onUpdate).toHaveBeenCalledWith({ objectFit: 'cover' })
    expect(onUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ layout: expect.anything() }))
  })

  it('edits src and never touches imageOid', () => {
    const onUpdate = vi.fn()
    const withOid: ImageBlock = { ...block, imageOid: 'snow-1' }
    render(<ImageSection block={withOid} onUpdate={onUpdate} />)
    fireEvent.change(screen.getByLabelText(/image source/i), { target: { value: 'new.png' } })
    expect(onUpdate).toHaveBeenCalledWith({ src: 'new.png' })
    expect(onUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ imageOid: expect.anything() }))
  })

  it('edits scalePercent as an integer', () => {
    const onUpdate = vi.fn()
    render(<ImageSection block={block} onUpdate={onUpdate} />)
    fireEvent.change(screen.getByLabelText(/scale/i), { target: { value: '25' } })
    expect(onUpdate).toHaveBeenCalledWith({ scalePercent: 25 })
  })

  it('empty scale input unsets scalePercent', () => {
    const onUpdate = vi.fn()
    render(<ImageSection block={{ ...block, scalePercent: 25 }} onUpdate={onUpdate} />)
    fireEvent.change(screen.getByLabelText(/scale/i), { target: { value: '' } })
    expect(onUpdate).toHaveBeenCalledWith({ scalePercent: undefined })
  })

  it('clamps an out-of-range scalePercent into 10–300 on blur', () => {
    const onUpdate = vi.fn()
    render(<ImageSection block={{ ...block, scalePercent: 500 }} onUpdate={onUpdate} />)
    fireEvent.blur(screen.getByLabelText(/scale/i))
    expect(onUpdate).toHaveBeenCalledWith({ scalePercent: 300 })
  })

  it('picks an image file and points src at the (deduped) filename', async () => {
    const onUpdate = vi.fn()
    render(<ImageSection block={block} onUpdate={onUpdate} />)
    const file = new File(['x'], 'photo.png', { type: 'image/png' })
    fireEvent.change(screen.getByTestId('image-file-input'), { target: { files: [file] } })
    // FileReader.onload is async; no spec is selected so setSpecImage is a no-op, but src is set.
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ src: 'photo.png' }))
  })
})
