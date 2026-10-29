// @vitest-environment jsdom
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
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { FormDocumentView } from '../FormDocumentView'
import { youtubeVideoId } from '../blocks/VideoBlockView'
import type { FormDocument } from '@mission/form-schema'

function docWith(blocks: FormDocument['sections'][0]['rows'][0]['blocks']): FormDocument {
  return { version: 2, sections: [{ id: 's1', role: 'content', rows: [{ id: 'r1', blocks }] }] }
}

describe('image block', () => {
  it('resolves src keys through the images prop, applies aspect-ratio and object-fit class', () => {
    const { container } = render(
      <FormDocumentView
        document={docWith([
          { id: 'im', type: 'image', src: 'pump.jpg', objectFit: 'cover', layout: { aspectRatio: '4/3' } },
        ])}
        images={(key) => (key === 'pump.jpg' ? 'data:image/png;base64,AAA' : undefined)}
      />,
    )
    const box = container.querySelector<HTMLElement>('[data-block-id="im"] .tfk-media')!
    expect(box.style.aspectRatio).toBe('4/3')
    expect(box.className).toContain('tfk-fit-cover')
    expect(box.querySelector('img')!.getAttribute('src')).toBe('data:image/png;base64,AAA')
  })

  it('https URLs bypass the resolver; unresolvable keys render a placeholder, not a broken img', () => {
    const { container } = render(
      <FormDocumentView
        document={docWith([
          { id: 'u', type: 'image', src: 'https://example.com/a.png', layout: { aspectRatio: '1/1' } },
          { id: 'm', type: 'image', src: 'missing.png', layout: { aspectRatio: '1/1' } },
        ])}
      />,
    )
    expect(container.querySelector('[data-block-id="u"] img')!.getAttribute('src')).toBe('https://example.com/a.png')
    expect(container.querySelector('[data-block-id="m"] img')).toBeNull()
    expect(container.querySelector('[data-block-id="m"] .tfk-media-placeholder')!.textContent).toContain('missing.png')
  })

  it('scalePercent sizes the media box as a % of the cell; 100/unset leave width alone', () => {
    const { container } = render(
      <FormDocumentView
        document={docWith([
          { id: 'sm', type: 'image', src: 'https://example.com/a.png', scalePercent: 25, layout: { aspectRatio: '1/1' } },
          { id: 'lg', type: 'image', src: 'https://example.com/a.png', scalePercent: 150, layout: { aspectRatio: '1/1' } },
          { id: 'df', type: 'image', src: 'https://example.com/a.png', scalePercent: 100, layout: { aspectRatio: '1/1' } },
          { id: 'un', type: 'image', src: 'https://example.com/a.png', layout: { aspectRatio: '1/1' } },
        ])}
      />,
    )
    const width = (id: string) => container.querySelector<HTMLElement>(`[data-block-id="${id}"] .tfk-media`)!.style.width
    expect(width('sm')).toBe('25%')
    expect(width('lg')).toBe('150%')
    expect(width('df')).toBe('')
    expect(width('un')).toBe('')
  })
})

describe('video block', () => {
  it('renders a controls-enabled video with poster in a 16/9 default aspect box', () => {
    const { container } = render(
      <FormDocumentView
        document={docWith([{ id: 'v', type: 'video', src: 'https://example.com/c.mp4', posterUrl: 'https://example.com/p.jpg' }])}
      />,
    )
    const box = container.querySelector<HTMLElement>('[data-block-id="v"] .tfk-media')!
    expect(box.style.aspectRatio).toBe('16/9')
    const video = box.querySelector('video')!
    expect(video.hasAttribute('controls')).toBe(true)
    expect(video.getAttribute('poster')).toBe('https://example.com/p.jpg')
    expect(video.getAttribute('preload')).toBe('none')
    expect(video.hasAttribute('autoplay')).toBe(false)
  })

  it('YouTube URLs render the embed iframe instead of a <video> (which cannot play page URLs)', () => {
    const { container } = render(
      <FormDocumentView
        document={docWith([{ id: 'yt', type: 'video', src: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }])}
      />,
    )
    const box = container.querySelector<HTMLElement>('[data-block-id="yt"] .tfk-media')!
    expect(box.querySelector('video')).toBeNull()
    const iframe = box.querySelector('iframe')!
    expect(iframe.getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
    expect(iframe.hasAttribute('allowfullscreen')).toBe(true)
  })
})

describe('youtubeVideoId', () => {
  it('parses every common YouTube URL shape', () => {
    for (const url of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ?si=abc123',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
      'https://www.youtube.com/live/dQw4w9WgXcQ',
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    ]) {
      expect(youtubeVideoId(url), url).toBe('dQw4w9WgXcQ')
    }
  })

  it('returns null for non-YouTube and non-URL sources', () => {
    for (const url of [
      'https://example.com/c.mp4',
      'https://vimeo.com/12345',
      'not a url',
      'https://www.youtube.com/feed/subscriptions',
      'https://notyoutube.com/watch?v=dQw4w9WgXcQ',
    ]) {
      expect(youtubeVideoId(url), url).toBeNull()
    }
  })
})

describe('divider block', () => {
  it('renders an hr; thick weight adds the thick class', () => {
    const { container } = render(
      <FormDocumentView
        document={docWith([
          { id: 'd1', type: 'divider' },
          { id: 'd2', type: 'divider', weight: 'thick' },
        ])}
      />,
    )
    expect(container.querySelector('[data-block-id="d1"] hr.tfk-hr')).not.toBeNull()
    expect(container.querySelector('[data-block-id="d2"] hr')!.className).toContain('tfk-hr-thick')
  })
})
