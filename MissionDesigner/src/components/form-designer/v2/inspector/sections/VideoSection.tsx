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
import type { Block, VideoBlock } from '@mission/form-schema'

const fieldStyle: React.CSSProperties = { marginBottom: 10 }

/**
 * Video section for VideoBlock properties.
 * Shows source URL and optional poster image URL.
 */
export function VideoSection({
  block: blockProp,
  onUpdate,
}: {
  block: Block
  onUpdate: (patch: Partial<Block>) => void
}) {
  const block = blockProp as VideoBlock

  return (
    <div style={{ padding: '4px 12px 12px' }}>
      {/* Source URL */}
      <div style={fieldStyle}>
        <label
          htmlFor="tfk-video-src"
          className="text-gray-500 dark:text-gray-400"
          style={{ fontSize: 11, display: 'block', marginBottom: 2 }}
        >
          Video URL (YouTube link or direct video file)
        </label>
        <input
          id="tfk-video-src"
          type="text"
          value={block.src}
          onChange={(e) => onUpdate({ src: e.target.value } as Partial<Block>)}
          className="bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 border border-gray-300 dark:border-gray-600"
          style={{
            width: '100%',
            fontSize: 13,
            padding: '4px 8px',
            borderRadius: 4,
            boxSizing: 'border-box',
            outline: 'none',
          }}
          placeholder="https://www.youtube.com/watch?v=… or https://example.com/video.mp4"
        />
      </div>

      {/* Poster URL */}
      <div style={fieldStyle}>
        <label
          htmlFor="tfk-video-poster"
          className="text-gray-500 dark:text-gray-400"
          style={{ fontSize: 11, display: 'block', marginBottom: 2 }}
        >
          Poster Image URL (optional, direct video files only)
        </label>
        <input
          id="tfk-video-poster"
          type="text"
          value={block.posterUrl ?? ''}
          onChange={(e) => onUpdate({ posterUrl: e.target.value || undefined } as Partial<Block>)}
          className="bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 border border-gray-300 dark:border-gray-600"
          style={{
            width: '100%',
            fontSize: 13,
            padding: '4px 8px',
            borderRadius: 4,
            boxSizing: 'border-box',
            outline: 'none',
          }}
          placeholder="https://example.com/thumbnail.jpg"
        />
      </div>
    </div>
  )
}
