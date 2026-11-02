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
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ImageSection } from '../ImageSection'
import type { ImageBlock } from '@mission/form-schema'
import { useFormDocumentStore } from '@/stores/formDocumentStore'

const block: ImageBlock = { id: 'b', type: 'image', src: 'logo.png', objectFit: 'contain' }

describe('ImageSection', () => {
  beforeEach(() => useFormDocumentStore.getState().setActiveBreakpoint('base'))

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

  describe('Scale on the Tablet and Phone tabs', () => {
    const scaleInput = () => screen.getByLabelText(/scale/i) as HTMLInputElement

    it('shows the inherited scale as a placeholder and names where it comes from', () => {
      useFormDocumentStore.getState().setActiveBreakpoint('phone')
      render(<ImageSection block={{ ...block, scalePercent: 60, scalePercentAt: { tablet: 40 } }} onUpdate={vi.fn()} />)
      expect(scaleInput().value).toBe('')
      expect(scaleInput().placeholder).toBe('40')
      expect(screen.getByText('(from Tablet)')).toBeTruthy()
    })

    it('writes only the override for the selected device', () => {
      useFormDocumentStore.getState().setActiveBreakpoint('phone')
      const onUpdate = vi.fn()
      render(<ImageSection block={{ ...block, scalePercent: 60 }} onUpdate={onUpdate} />)
      fireEvent.change(scaleInput(), { target: { value: '25' } })
      expect(onUpdate).toHaveBeenCalledWith({ scalePercentAt: { phone: 25 } })
      expect(onUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ scalePercent: expect.anything() }))
    })

    it('clamps the selected device on blur', () => {
      useFormDocumentStore.getState().setActiveBreakpoint('tablet')
      const onUpdate = vi.fn()
      render(
        <ImageSection block={{ ...block, scalePercent: 60, scalePercentAt: { tablet: 500 } }} onUpdate={onUpdate} />,
      )
      fireEvent.blur(scaleInput())
      expect(onUpdate).toHaveBeenCalledWith({ scalePercentAt: { tablet: 300 } })
    })

    it('Clear override returns the device to the inherited scale', () => {
      useFormDocumentStore.getState().setActiveBreakpoint('phone')
      const onUpdate = vi.fn()
      render(<ImageSection block={{ ...block, scalePercent: 60, scalePercentAt: { phone: 25 } }} onUpdate={onUpdate} />)
      fireEvent.click(screen.getByRole('button', { name: /clear phone override/i }))
      expect(onUpdate).toHaveBeenCalledWith({ scalePercentAt: undefined })
    })

    it('Desktop keeps editing scalePercent and shows no Clear button', () => {
      const onUpdate = vi.fn()
      render(<ImageSection block={{ ...block, scalePercentAt: { phone: 25 } }} onUpdate={onUpdate} />)
      expect(screen.queryByRole('button', { name: /clear/i })).toBeNull()
      expect(scaleInput().placeholder).toBe('100')
    })
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
