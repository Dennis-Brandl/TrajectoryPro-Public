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
import { useEffect, useState } from 'react'

export interface ToastMessage {
  id: number
  text: string
}

const TOAST_DURATION_MS = 5000

let nextId = 1

// Forwards useToast().show() calls to whichever <Toasts/> instance is
// currently mounted, rather than keeping the queue in module state. Because
// the toast list lives in that instance's own useState (not in this module),
// unmounting — e.g. between tests — leaves nothing behind to bleed into the
// next mount.
let activeShow: ((text: string) => void) | null = null

export interface UseToastResult {
  show(text: string): void
}

export function useToast(): UseToastResult {
  return {
    show(text: string) {
      activeShow?.(text)
    },
  }
}

export function Toasts() {
  const [toasts, setToasts] = useState<ToastMessage[]>([])

  useEffect(() => {
    activeShow = (text: string) => {
      const id = nextId++
      setToasts((prev) => [...prev, { id, text }])
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id))
      }, TOAST_DURATION_MS)
    }
    return () => {
      activeShow = null
    }
  }, [])

  return (
    <div role="status" className="toast-region">
      {toasts.map((t) => (
        <p key={t.id} className="toast">
          {t.text}
        </p>
      ))}
    </div>
  )
}
