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

import { useState, useEffect, useRef, useCallback } from 'react'
import type { Block } from '@mission/form-schema'

/**
 * Hook to debounce a text field: keeps a local draft that syncs immediately
 * on screen, then fires onUpdate after a delay.
 */
export function useDebouncedField(
  blockId: string,
  value: string,
  onUpdate: (patch: Partial<Block>) => void,
  field: string,
  delay = 300,
) {
  const [draft, setDraft] = useState(value)
  const [synced, setSynced] = useState({ blockId, value })
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Reset the draft when the block or its upstream value changes (block switch, undo/redo).
  // Done during render — React's "adjust state during render" — so the input never paints a
  // frame of the previous block's text (which a post-commit effect would allow).
  if (synced.blockId !== blockId || synced.value !== value) {
    setSynced({ blockId, value })
    setDraft(value)
  }

  const handleChange = useCallback(
    (newValue: string) => {
      setDraft(newValue)
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        onUpdate({ [field]: newValue } as Partial<Block>)
      }, delay)
    },
    [onUpdate, field, delay],
  )

  // Flush on unmount
  useEffect(() => () => clearTimeout(timerRef.current), [])

  return [draft, handleChange] as const
}
