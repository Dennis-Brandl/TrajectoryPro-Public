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

import { useState } from 'react'
import { Lightbulb, X } from 'lucide-react'

const DISMISS_KEY = 'designer:formArrangeTipsHidden'

/** Link to the help guide's section on arranging form elements. */
export const ARRANGE_HELP_HREF = '/help.html#adding-and-arranging-elements'

function readHidden(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * A one-line strip above the form canvas saying how to arrange elements and make columns —
 * the drag handles only appear on hover, so nothing on screen says they exist. Hiding it is
 * remembered in this browser (a convenience only; it shows again if storage is unavailable).
 */
export function ArrangeTips() {
  const [hidden, setHidden] = useState(readHidden)
  if (hidden) return null
  const hide = () => {
    setHidden(true)
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      /* storage unavailable — hidden for this session only */
    }
  }
  return (
    <div
      role="note"
      aria-label="Arranging tips"
      className="bg-blue-50 text-slate-700 dark:bg-slate-800 dark:text-slate-200 border-b border-blue-100 dark:border-slate-700"
      style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 12px', fontSize: 12, lineHeight: 1.5 }}
    >
      <Lightbulb size={14} style={{ flexShrink: 0, marginTop: 2 }} className="text-blue-600 dark:text-blue-400" />
      <span style={{ flex: 1 }}>
        Each row is split into columns. Hover a row to see its grips: drag an element&apos;s grip to move it, and drop
        it <strong>beside</strong> another element to put them side by side. Or right-click an element and choose{' '}
        <strong>Arrange in 2 columns</strong> (also in Layout on the right). Drag the line between two elements to
        change their widths; the Tablet and Phone tabs can set their own.{' '}
        <a
          href={ARRANGE_HELP_HREF}
          target="_blank"
          rel="noopener noreferrer"
          className="underline text-blue-700 dark:text-blue-300"
        >
          Help
        </a>
      </span>
      <button
        type="button"
        aria-label="Hide tips"
        title="Hide tips"
        onClick={hide}
        style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 2 }}
      >
        <X size={14} />
      </button>
    </div>
  )
}
