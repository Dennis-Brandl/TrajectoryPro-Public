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
import type { CSSProperties } from 'react'
import type { ImageBlock } from '@mission/form-schema'
import { useFormRenderer } from '../context'

const FIT_CLASS = { contain: 'tfk-fit-contain', cover: 'tfk-fit-cover', fill: 'tfk-fit-fill' } as const

export function ImageBlockView({ block }: { block: ImageBlock }) {
  const { resolveImage } = useFormRenderer()
  const isUrl = block.src.startsWith('https://') || block.src.startsWith('http://')
  const src = isUrl ? block.src : resolveImage(block.src)
  // Scale sizes the media box relative to its grid cell (100 = fill the cell, the default).
  // Height follows layout.aspectRatio, so the whole box scales. Each device's value travels as
  // a custom property; controls.css picks one by container width, like every responsive rule.
  const { scalePercent: base, scalePercentAt: at } = block
  const scaled = base !== undefined || at?.tablet !== undefined || at?.phone !== undefined
  const scaleVars: Record<string, string> = {}
  if (base !== undefined) scaleVars['--tfk-scale-base'] = `${base}%`
  if (at?.tablet !== undefined) scaleVars['--tfk-scale-tablet'] = `${at.tablet}%`
  if (at?.phone !== undefined) scaleVars['--tfk-scale-phone'] = `${at.phone}%`
  return (
    <div
      className={`tfk-media ${FIT_CLASS[block.objectFit ?? 'contain']}${scaled ? ' tfk-media-scaled' : ''}`}
      style={{ aspectRatio: block.layout?.aspectRatio, ...scaleVars } as CSSProperties}
    >
      {src ? <img src={src} alt="" /> : <div className="tfk-media-placeholder">{block.src}</div>}
    </div>
  )
}
