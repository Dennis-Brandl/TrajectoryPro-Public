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
import { useEffect, useRef } from 'react'

// Spec §15 keyboard shortcuts, with plan rulings P4-R1..R5. Matching is pure so every
// keyboard quirk is unit-tested; each owner registers only the keys it handles
// (WorkView: tabs, / and ?; the task on screen: Ctrl+Enter; the context bar: copy).

export type Shortcut =
  | { kind: 'tab'; index: number }
  | { kind: 'submit' }
  | { kind: 'copy' }
  | { kind: 'filter' }
  | { kind: 'help' }
export type ShortcutKind = Shortcut['kind']

export interface KeyLike {
  key: string
  code: string
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  repeat?: boolean
  isComposing?: boolean
  keyCode?: number
  target: EventTarget | null
}

/** The `?` sheet's rows, in display order. */
export const SHORTCUT_LIST: ReadonlyArray<{ keys: string; does: string }> = [
  { keys: 'Alt+1 … Alt+9', does: 'Open claim 1 to 9' },
  { keys: 'Alt+0', does: 'Go to the inbox' },
  { keys: 'Ctrl+Enter', does: 'Complete the task (when its Continue button is enabled)' },
  { keys: 'Ctrl+Shift+C', does: 'Copy the runtime ID' },
  { keys: '/', does: 'Filter the inbox' },
  { keys: '?', does: 'Show this list' },
  { keys: 'Esc', does: 'Close a panel' },
]

const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image'])

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  // The attribute check covers environments without isContentEditable (jsdom).
  if (target.isContentEditable || target.closest('[contenteditable]:not([contenteditable="false"])')) return true
  const tag = target.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') return !NON_TEXT_INPUTS.has((target as HTMLInputElement).type)
  return false
}

const DIGIT = /^Digit([0-9])$/

export function matchShortcut(e: KeyLike): Shortcut | null {
  // P4-R5: an IME is mid-composition — the keys belong to it.
  if (e.isComposing || e.keyCode === 229) return null

  // P4-R1: by physical digit (macOS Option changes e.key). Ctrl+Alt is Windows AltGr,
  // which types characters on European layouts; Alt+Numpad is Windows character entry.
  if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
    const digit = DIGIT.exec(e.code)
    if (!digit) return null
    // macOS Option is how Mac users type #, [, {, £… (Option+3 is '#' on a UK Mac). In a
    // text field, a key that produces something other than the digit belongs to the field.
    if (isTypingTarget(e.target) && e.key !== digit[1]) return null
    return { kind: 'tab', index: Number(digit[1]) }
  }

  if (e.repeat) return null

  // P4-R2: also from inside a field — that is where the operator is when they finish.
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key === 'Enter') return { kind: 'submit' }

  // P4-R3 — not from inside a text field, where Ctrl+Shift+C is the operator's own copy.
  if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.code === 'KeyC') {
    return isTypingTarget(e.target) ? null : { kind: 'copy' }
  }

  // P4-R4: by character, so any keyboard layout works; never while typing.
  if (!e.ctrlKey && !e.metaKey && !e.altKey && !isTypingTarget(e.target)) {
    if (e.key === '/') return { kind: 'filter' }
    if (e.key === '?') return { kind: 'help' }
  }
  return null
}

/** A modal sheet owns the keyboard while it is open (its own Escape still works). */
export function modalOpen(doc: Document = document): boolean {
  return doc.querySelector('[aria-modal="true"]') !== null
}

export function useShortcut<K extends ShortcutKind>(
  kind: K,
  handler: ((s: Extract<Shortcut, { kind: K }>) => void) | null | undefined,
  enabled = true,
): void {
  const handlerRef = useRef(handler)
  handlerRef.current = handler
  const active = enabled && !!handler

  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      const hit = matchShortcut(e)
      if (!hit || hit.kind !== kind || modalOpen()) return
      const current = handlerRef.current
      if (!current) return
      e.preventDefault()
      current(hit as Extract<Shortcut, { kind: K }>)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [kind, active])
}
