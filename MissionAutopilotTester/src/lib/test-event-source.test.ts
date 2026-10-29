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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  installMockEventSource,
  restoreEventSource,
  getMockEventSources,
  MockEventSource,
} from './test-event-source'

describe('MockEventSource', () => {
  beforeEach(() => installMockEventSource())
  afterEach(() => restoreEventSource())

  it('records constructions and exposes them via getMockEventSources', () => {
    const a = new EventSource('http://x/inst-1/events')
    const b = new EventSource('http://x/inst-2/events')
    expect(getMockEventSources()).toHaveLength(2)
    expect(getMockEventSources()[0]).toBe(a)
    expect(getMockEventSources()[1]).toBe(b)
  })

  it('starts in CONNECTING (0) and transitions to OPEN (1) on __open()', () => {
    const es = new EventSource('http://x') as unknown as MockEventSource
    expect(es.readyState).toBe(0)
    const onopen = vi.fn()
    es.onopen = onopen
    es.__open()
    expect(es.readyState).toBe(1)
    expect(onopen).toHaveBeenCalledTimes(1)
  })

  it('__emit dispatches to addEventListener handlers by type', () => {
    const es = new EventSource('http://x') as unknown as MockEventSource
    es.__open()
    const handler = vi.fn()
    es.addEventListener('state_change', handler)
    es.__emit('state_change', { foo: 'bar' }, 7)
    expect(handler).toHaveBeenCalledTimes(1)
    const event = handler.mock.calls[0]![0] as MessageEvent
    expect(event.data).toBe(JSON.stringify({ foo: 'bar' }))
    expect(event.lastEventId).toBe('7')
  })

  it('removeEventListener stops further dispatch', () => {
    const es = new EventSource('http://x') as unknown as MockEventSource
    es.__open()
    const handler = vi.fn()
    es.addEventListener('output', handler)
    es.removeEventListener('output', handler)
    es.__emit('output', {}, 1)
    expect(handler).not.toHaveBeenCalled()
  })

  it('close() sets readyState to CLOSED (2) and silences further __emit', () => {
    const es = new EventSource('http://x') as unknown as MockEventSource
    es.__open()
    const handler = vi.fn()
    es.addEventListener('log', handler)
    es.close()
    expect(es.readyState).toBe(2)
    es.__emit('log', {}, 1)
    expect(handler).not.toHaveBeenCalled()
  })

  it('__error fires onerror and does not auto-close', () => {
    const es = new EventSource('http://x') as unknown as MockEventSource
    es.__open()
    const onerror = vi.fn()
    es.onerror = onerror
    es.__error()
    expect(onerror).toHaveBeenCalledTimes(1)
    // MockEventSource does not simulate native auto-reconnect — tests drive that explicitly.
    expect(es.readyState).toBe(1)
  })

  it('__error dispatches to addEventListener("error", handler) too', () => {
    const es = new EventSource('http://x') as unknown as MockEventSource
    es.__open()
    const handler = vi.fn()
    es.addEventListener('error', handler as unknown as (e: MessageEvent) => void)
    es.__error()
    expect(handler).toHaveBeenCalledTimes(1)
  })
})

describe('install/restore', () => {
  // Setup file pre-installs the mock globally; undo that so each test here
  // starts with the original (real) EventSource visible, then re-arm afterwards.
  beforeEach(() => restoreEventSource())
  afterEach(() => installMockEventSource())

  it('restoreEventSource brings back the original global', () => {
    const original = globalThis.EventSource
    installMockEventSource()
    expect(globalThis.EventSource).not.toBe(original)
    restoreEventSource()
    expect(globalThis.EventSource).toBe(original)
  })
})
