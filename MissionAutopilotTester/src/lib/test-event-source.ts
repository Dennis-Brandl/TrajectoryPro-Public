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

type Listener = (event: MessageEvent) => void

export class MockEventSource {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 2

  readyState = 0
  withCredentials = false

  onopen: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onmessage: Listener | null = null

  private listeners = new Map<string, Set<Listener>>()

  constructor(public readonly url: string, init?: EventSourceInit) {
    if (init?.withCredentials) this.withCredentials = true
    registry.push(this)
  }

  addEventListener(type: string, listener: Listener): void {
    let set = this.listeners.get(type)
    if (!set) {
      set = new Set()
      this.listeners.set(type, set)
    }
    set.add(listener)
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener)
  }

  close(): void {
    this.readyState = 2
    this.listeners.clear()
  }

  // -------- test helpers --------

  __open(): void {
    if (this.readyState === 2) return
    this.readyState = 1
    if (this.onopen) this.onopen(new Event('open'))
  }

  __emit(type: string, data: unknown, id: number | string): void {
    if (this.readyState === 2) return
    const message = new MessageEvent(type, {
      data: JSON.stringify(data),
      lastEventId: String(id),
    })
    if (type === 'message' && this.onmessage) {
      this.onmessage(message)
    }
    for (const listener of this.listeners.get(type) ?? []) {
      listener(message)
    }
  }

  __error(): void {
    if (this.readyState === 2) return
    const event = new Event('error')
    if (this.onerror) this.onerror(event)
    for (const listener of this.listeners.get('error') ?? []) {
      listener(event as unknown as MessageEvent)
    }
  }
}

let registry: MockEventSource[] = []
let original: typeof EventSource | undefined

export function installMockEventSource(): void {
  if (!original) {
    original = globalThis.EventSource as typeof EventSource | undefined
  }
  registry = []
  ;(globalThis as { EventSource: typeof EventSource }).EventSource =
    MockEventSource as unknown as typeof EventSource
}

export function restoreEventSource(): void {
  if (original === undefined) {
    delete (globalThis as { EventSource?: typeof EventSource }).EventSource
  } else {
    ;(globalThis as { EventSource: typeof EventSource }).EventSource = original
  }
  original = undefined
  registry = []
}

export function getMockEventSources(): MockEventSource[] {
  return registry
}
