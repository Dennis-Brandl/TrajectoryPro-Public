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
import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyText } from '@/lib/copy-text'

describe('copyText', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    Reflect.deleteProperty(document, 'execCommand')
  })

  function stubSelectionCopy(result: boolean) {
    const copied: string[] = []
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: () => {
        copied.push(document.querySelector('textarea')?.value ?? '')
        return result
      },
    })
    return copied
  }

  it('copies by selection on plain http, where navigator.clipboard does not exist', async () => {
    vi.stubGlobal('navigator', {})
    const copied = stubSelectionCopy(true)

    await expect(copyText('a,b')).resolves.toBe(true)
    expect(copied).toEqual(['a,b'])
  })

  it('falls back to selection when the browser refuses clipboard access', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: () => Promise.reject(new Error('denied')) } })
    const copied = stubSelectionCopy(true)

    await expect(copyText('a,b')).resolves.toBe(true)
    expect(copied).toEqual(['a,b'])
  })

  it('reports failure when neither way of copying works', async () => {
    vi.stubGlobal('navigator', {})
    stubSelectionCopy(false)

    await expect(copyText('a,b')).resolves.toBe(false)
  })

  it('removes its temporary element from the page', async () => {
    vi.stubGlobal('navigator', {})
    stubSelectionCopy(true)

    await copyText('a,b')

    expect(document.querySelectorAll('textarea')).toHaveLength(0)
  })
})
