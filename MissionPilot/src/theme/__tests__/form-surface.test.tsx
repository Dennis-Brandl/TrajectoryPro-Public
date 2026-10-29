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
import { renderHook, act, waitFor } from '@testing-library/react'
import { readFormSurface, useFormSurface } from '../form-surface'

// jsdom does not resolve var(): stand in for the browser by mapping the root's mode.
function fakeComputedStyle() {
  const real = window.getComputedStyle
  return vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
    const style = real(el, pseudo)
    if ((el as HTMLElement).style?.color === 'var(--form-color-surface)') {
      const dark = document.documentElement.getAttribute('data-pilot-mode') === 'dark'
      return { ...style, color: dark ? 'rgb(19, 28, 46)' : 'rgb(255, 255, 255)' } as CSSStyleDeclaration
    }
    return style
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  document.documentElement.removeAttribute('data-pilot-mode')
  document.getElementById('pilot-theme')?.remove()
})

describe('form surface (spec §14)', () => {
  it('reads --form-color-surface through a probe and leaves no probe behind', () => {
    fakeComputedStyle()
    const before = document.body.childElementCount
    expect(readFormSurface()).toBe('rgb(255, 255, 255)')
    expect(document.body.childElementCount).toBe(before)
  })

  it('an unresolved value reads as undefined (the renderer then keeps authored colours)', () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ color: '' } as CSSStyleDeclaration)
    expect(readFormSurface()).toBeUndefined()
  })

  it('re-reads when the display mode flips', async () => {
    fakeComputedStyle()
    const { result } = renderHook(() => useFormSurface())
    expect(result.current).toBe('rgb(255, 255, 255)')
    act(() => document.documentElement.setAttribute('data-pilot-mode', 'dark'))
    await waitFor(() => expect(result.current).toBe('rgb(19, 28, 46)'))
    act(() => document.documentElement.setAttribute('data-pilot-mode', 'light'))
    await waitFor(() => expect(result.current).toBe('rgb(255, 255, 255)'))
  })

  it('re-reads when the theme style sheet arrives or changes', async () => {
    const spy = fakeComputedStyle()
    renderHook(() => useFormSurface())
    const calls = spy.mock.calls.length
    const style = document.createElement('style')
    style.id = 'pilot-theme'
    act(() => {
      document.head.appendChild(style)
    })
    await waitFor(() => expect(spy.mock.calls.length).toBeGreaterThan(calls))
    const after = spy.mock.calls.length
    act(() => {
      style.textContent = ':root { --pilot-surface-raised: #000000 }'
    })
    await waitFor(() => expect(spy.mock.calls.length).toBeGreaterThan(after))
  })
})
