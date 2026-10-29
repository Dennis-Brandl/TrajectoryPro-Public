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
import { SseManager, protocolPairs } from '../sse-manager.js'

describe('SseManager teardown closers', () => {
  let manager: SseManager
  afterEach(() => manager?.shutdown())

  it('destroyInstanceBus invokes each subscriber closer once and drops it', () => {
    manager = new SseManager()
    const close = vi.fn()
    manager.subscribe('inst-1', () => undefined, close)
    manager.destroyInstanceBus('inst-1')
    manager.destroyInstanceBus('inst-1')
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('an unsubscribed listener is not closed on teardown', () => {
    manager = new SseManager()
    const close = vi.fn()
    const unsubscribe = manager.subscribe('inst-2', () => undefined, close)
    unsubscribe()
    manager.destroyInstanceBus('inst-2')
    expect(close).not.toHaveBeenCalled()
  })

  it("destroyPropertyBuses closes only that environment's property streams", () => {
    manager = new SseManager()
    const a = vi.fn()
    const b = vi.fn()
    manager.subscribeProperty('env-a', 'MODE', () => undefined, a)
    manager.subscribeProperty('env-b', 'MODE', () => undefined, b)
    manager.destroyPropertyBuses('env-a')
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).not.toHaveBeenCalled()
  })

  it('shutdown closes every instance and property stream and survives a throwing closer', () => {
    manager = new SseManager()
    const boom = vi.fn(() => {
      throw new Error('closed twice')
    })
    const ok = vi.fn()
    manager.subscribe('inst-3', () => undefined, boom)
    manager.subscribeProperty('env-c', 'MODE', () => undefined, ok)
    expect(() => manager.shutdown()).not.toThrow()
    expect(boom).toHaveBeenCalledTimes(1)
    expect(ok).toHaveBeenCalledTimes(1)
  })
})

describe('protocolPairs', () => {
  it('adds the protocol name to stored {key, value} pairs and keeps key', () => {
    expect(
      protocolPairs([
        { key: 'A', value: '1' },
        { name: 'B', value: '2' },
      ])
    ).toEqual([
      { name: 'A', key: 'A', value: '1' },
      { name: 'B', value: '2' },
    ])
    expect(protocolPairs(null)).toEqual([])
  })
})
