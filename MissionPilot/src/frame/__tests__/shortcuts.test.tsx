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
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { matchShortcut, isTypingTarget, modalOpen, useShortcut, type KeyLike, type Shortcut } from '../shortcuts'

function key(over: Partial<KeyLike>): KeyLike {
  return { key: '', code: '', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, target: document.body, ...over }
}

afterEach(cleanup)

describe('matchShortcut (spec §15, P4-R1..R5)', () => {
  it('Alt+0..9 by physical digit, whatever the key produces (macOS Option)', () => {
    expect(matchShortcut(key({ altKey: true, code: 'Digit1', key: '1' }))).toEqual({ kind: 'tab', index: 1 })
    expect(matchShortcut(key({ altKey: true, code: 'Digit9', key: 'ª' }))).toEqual({ kind: 'tab', index: 9 })
    expect(matchShortcut(key({ altKey: true, code: 'Digit0', key: 'º' }))).toEqual({ kind: 'tab', index: 0 })
  })

  it('never on AltGr (Ctrl+Alt), Alt+Shift, Alt+Meta or the numpad (Windows Alt codes)', () => {
    expect(matchShortcut(key({ altKey: true, ctrlKey: true, code: 'Digit7', key: '{' }))).toBeNull()
    expect(matchShortcut(key({ altKey: true, shiftKey: true, code: 'Digit2' }))).toBeNull()
    expect(matchShortcut(key({ altKey: true, metaKey: true, code: 'Digit2' }))).toBeNull()
    expect(matchShortcut(key({ altKey: true, code: 'Numpad1', key: '1' }))).toBeNull()
  })

  it('inside a text field, Option+digit that types a character (macOS #, [, {) is left to the field (final review)', () => {
    const input = document.createElement('input')
    // UK Mac: Option+3 types '#'; German Mac: Option+5 types '['.
    expect(matchShortcut(key({ altKey: true, code: 'Digit3', key: '#', target: input }))).toBeNull()
    expect(matchShortcut(key({ altKey: true, code: 'Digit5', key: '[', target: input }))).toBeNull()
    // Windows Alt+1 reports the digit itself, so it still switches tabs from a field.
    expect(matchShortcut(key({ altKey: true, code: 'Digit1', key: '1', target: input }))).toEqual({ kind: 'tab', index: 1 })
    // Outside a field Option+digit still switches tabs (nothing to type into).
    expect(matchShortcut(key({ altKey: true, code: 'Digit3', key: '#' }))).toEqual({ kind: 'tab', index: 3 })
  })

  it('Ctrl+Enter or Cmd+Enter submits — also from inside a field — but not on auto-repeat', () => {
    const input = document.createElement('input')
    expect(matchShortcut(key({ ctrlKey: true, key: 'Enter', code: 'Enter' }))).toEqual({ kind: 'submit' })
    expect(matchShortcut(key({ metaKey: true, key: 'Enter', code: 'Enter' }))).toEqual({ kind: 'submit' })
    expect(matchShortcut(key({ ctrlKey: true, key: 'Enter', code: 'Enter', target: input }))).toEqual({ kind: 'submit' })
    expect(matchShortcut(key({ ctrlKey: true, key: 'Enter', code: 'Enter', repeat: true }))).toBeNull()
    expect(matchShortcut(key({ ctrlKey: true, shiftKey: true, key: 'Enter', code: 'Enter' }))).toBeNull()
    expect(matchShortcut(key({ key: 'Enter', code: 'Enter' }))).toBeNull()
  })

  it('Ctrl+Shift+C copies, by physical key', () => {
    expect(matchShortcut(key({ ctrlKey: true, shiftKey: true, code: 'KeyC', key: 'C' }))).toEqual({ kind: 'copy' })
    expect(matchShortcut(key({ ctrlKey: true, code: 'KeyC', key: 'c' }))).toBeNull()
    expect(matchShortcut(key({ ctrlKey: true, shiftKey: true, code: 'KeyC', key: 'C', repeat: true }))).toBeNull()
  })

  it('Ctrl+Shift+C is left to a text field (a terminal-style copy habit keeps working there)', () => {
    const input = document.createElement('input')
    expect(matchShortcut(key({ ctrlKey: true, shiftKey: true, code: 'KeyC', key: 'C', target: input }))).toBeNull()
  })

  it('/ and ? by character, only outside text entry', () => {
    expect(matchShortcut(key({ key: '/', code: 'Slash' }))).toEqual({ kind: 'filter' })
    expect(matchShortcut(key({ key: '?', code: 'Slash', shiftKey: true }))).toEqual({ kind: 'help' })
    // German layout: / is Shift+7.
    expect(matchShortcut(key({ key: '/', code: 'Digit7', shiftKey: true }))).toEqual({ kind: 'filter' })
    const textarea = document.createElement('textarea')
    expect(matchShortcut(key({ key: '/', target: textarea }))).toBeNull()
    expect(matchShortcut(key({ key: '?', target: textarea }))).toBeNull()
    expect(matchShortcut(key({ key: '/', ctrlKey: true }))).toBeNull()
  })

  it('nothing during an IME composition', () => {
    expect(matchShortcut(key({ ctrlKey: true, key: 'Enter', isComposing: true }))).toBeNull()
    expect(matchShortcut(key({ key: '/', keyCode: 229 }))).toBeNull()
  })
})

describe('isTypingTarget', () => {
  it('text inputs, textareas, selects and contenteditable count; checkboxes and buttons do not', () => {
    const make = (html: string) => {
      const host = document.createElement('div')
      host.innerHTML = html
      return host.firstElementChild!
    }
    expect(isTypingTarget(make('<input>'))).toBe(true)
    expect(isTypingTarget(make('<input type="search">'))).toBe(true)
    expect(isTypingTarget(make('<input type="password">'))).toBe(true)
    expect(isTypingTarget(make('<textarea></textarea>'))).toBe(true)
    expect(isTypingTarget(make('<select></select>'))).toBe(true)
    const editable = make('<div contenteditable="true"></div>') as HTMLElement
    document.body.appendChild(editable)
    expect(isTypingTarget(editable)).toBe(true)
    editable.remove()
    expect(isTypingTarget(make('<input type="checkbox">'))).toBe(false)
    expect(isTypingTarget(make('<input type="radio">'))).toBe(false)
    expect(isTypingTarget(make('<button></button>'))).toBe(false)
    expect(isTypingTarget(document.body)).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })
})

describe('useShortcut', () => {
  function Probe({ kind, onHit, enabled }: { kind: Shortcut['kind']; onHit: (s: Shortcut) => void; enabled?: boolean }) {
    useShortcut(kind, onHit, enabled)
    return null
  }

  it('calls the handler for its own kind only, and prevents the browser default', () => {
    const onHit = vi.fn()
    render(<Probe kind="submit" onHit={onHit} />)
    expect(fireEvent.keyDown(document.body, { key: '/', code: 'Slash' })).toBe(true)
    expect(onHit).not.toHaveBeenCalled()
    // fireEvent returns false when preventDefault was called.
    expect(fireEvent.keyDown(document.body, { key: 'Enter', code: 'Enter', ctrlKey: true })).toBe(false)
    expect(onHit).toHaveBeenCalledWith({ kind: 'submit' })
  })

  it('does nothing while disabled, with no handler, or while a modal sheet is open', () => {
    const onHit = vi.fn()
    const view = render(<Probe kind="help" onHit={onHit} enabled={false} />)
    fireEvent.keyDown(document.body, { key: '?' })
    expect(onHit).not.toHaveBeenCalled()

    view.rerender(<Probe kind="help" onHit={onHit} />)
    const modal = document.createElement('div')
    modal.setAttribute('aria-modal', 'true')
    document.body.appendChild(modal)
    expect(modalOpen()).toBe(true)
    expect(fireEvent.keyDown(document.body, { key: '?' })).toBe(true)
    expect(onHit).not.toHaveBeenCalled()
    modal.remove()
    expect(modalOpen()).toBe(false)
    fireEvent.keyDown(document.body, { key: '?' })
    expect(onHit).toHaveBeenCalledTimes(1)
  })

  it('always calls the latest handler (no stale closure)', () => {
    const first = vi.fn()
    const second = vi.fn()
    const view = render(<Probe kind="filter" onHit={first} />)
    view.rerender(<Probe kind="filter" onHit={second} />)
    fireEvent.keyDown(document.body, { key: '/' })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
})
