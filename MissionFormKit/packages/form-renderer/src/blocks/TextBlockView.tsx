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
import { useMemo } from 'react'
import type { TextBlock } from '@mission/form-schema'
import { sanitizeHtml } from '../sanitize'
import { alignClass, sizeClasses, useAuthoredColor, useGuardedHtml } from './common'

export function TextBlockView({ block }: { block: TextBlock }) {
  // Every fieldChange re-renders the whole tree, so without this each keystroke costs a
  // full DOMPurify parse of every text block on the screen.
  const html = useGuardedHtml(useMemo(() => sanitizeHtml(block.content), [block.content]))
  const color = useAuthoredColor(block.color)
  return (
    <div
      className={`tfk-text ${sizeClasses(block.size, block.sizeAt, 'md')}${block.fontWeight === 'bold' ? ' tfk-bold' : ''}${alignClass(block.align)}`}
      style={color ? { color } : undefined}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
