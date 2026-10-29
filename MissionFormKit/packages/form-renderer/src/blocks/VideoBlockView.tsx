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
import type { VideoBlock } from '@mission/form-schema'

/**
 * Extract a YouTube video id from any of the common URL shapes, or null when the
 * URL is not YouTube. A page URL cannot be fed to an HTML <video> element (it only
 * plays direct media files), so YouTube sources render as the official embed iframe.
 * Handles: watch?v=ID, youtu.be/ID, /shorts/ID, /embed/ID, /live/ID.
 */
export function youtubeVideoId(src: string): string | null {
  let url: URL
  try {
    url = new URL(src)
  } catch {
    return null
  }
  const host = url.hostname.replace(/^www\.|^m\./, '')
  const idOk = (id: string | null | undefined) => (id && /^[\w-]{6,}$/.test(id) ? id : null)
  if (host === 'youtu.be') return idOk(url.pathname.split('/')[1])
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') return idOk(url.searchParams.get('v'))
    const m = url.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]+)/)
    return idOk(m?.[1])
  }
  return null
}

export function VideoBlockView({ block }: { block: VideoBlock }) {
  const youtubeId = youtubeVideoId(block.src)
  return (
    <div className="tfk-media" style={{ aspectRatio: block.layout?.aspectRatio ?? '16/9' }}>
      {youtubeId ? (
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${youtubeId}`}
          title="YouTube video"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          style={{ width: '100%', height: '100%', border: 0, display: 'block' }}
        />
      ) : (
        <video controls preload="none" src={block.src} poster={block.posterUrl} />
      )}
    </div>
  )
}
