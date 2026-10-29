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

// Spec §14: FormKit judges authored block colours against the colour the form is drawn
// on. That colour is a token chain (--form-color-surface → --pilot-surface-raised → the
// theme), so only the browser knows its value: resolve it through a probe element.

export function readFormSurface(doc: Document = document): string | undefined {
  if (!doc.body) return undefined
  const probe = doc.createElement('span')
  probe.style.display = 'none'
  probe.style.color = 'var(--form-color-surface)'
  doc.body.appendChild(probe)
  try {
    const value = window.getComputedStyle(probe).color
    return value && !value.startsWith('var(') ? value : undefined
  } finally {
    probe.remove()
  }
}

/**
 * The resolved form surface, kept current. It changes when the operator flips light/dark
 * (or the OS does, in System mode) — both set data-pilot-mode — and when a theme arrives
 * or changes (#pilot-theme in <head>, data-pilot-theme on the root).
 */
export function useFormSurface(): string | undefined {
  const [surface, setSurface] = useState(() => readFormSurface())
  useEffect(() => {
    const update = () => setSurface(readFormSurface())
    update()
    // Observes the root's two attributes and <head> only: the probe goes into <body>, so
    // reading never triggers another read.
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-pilot-mode', 'data-pilot-theme'] })
    observer.observe(document.head, { childList: true, subtree: true, characterData: true })
    return () => observer.disconnect()
  }, [])
  return surface
}
