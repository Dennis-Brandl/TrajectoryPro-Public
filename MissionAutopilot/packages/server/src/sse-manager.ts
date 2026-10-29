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

import type { Instance } from '@mission/autopilot-storage'
import type { PropertyWriteSource } from '@mission/autopilot-engine'

// ============================================================
// SseEvent — wire format for every Server-Sent Event
// ============================================================

export interface SseEvent {
  id: number
  type: 'state_change' | 'output' | 'log' | 'heartbeat' | 'property'
  data: Record<string, unknown>
}

// ============================================================
// Private per-instance bus
// ============================================================

interface InstanceBus {
  buffer: SseEvent[]
  nextId: number
  listeners: Set<(event: SseEvent) => void>
  closers: Set<() => void>
  heartbeatTimer: NodeJS.Timeout
  terminalTimer?: NodeJS.Timeout
}

// ============================================================
// Constants
// ============================================================

const BUFFER_SIZE = 256
const HEARTBEAT_MS = 30_000
const TERMINAL_LINGER_MS = 7_000

// ============================================================
// SseManager — per-instance event bus with ring buffer and heartbeat
// ============================================================

export class SseManager {
  private readonly buses = new Map<string, InstanceBus>()

  // --------------------------------------------------------
  // Private: bus lifecycle
  // --------------------------------------------------------

  private getOrCreateBus(instanceId: string): InstanceBus {
    const existing = this.buses.get(instanceId)
    if (existing) return existing

    const bus: InstanceBus = {
      buffer: [],
      nextId: 0,
      listeners: new Set(),
      closers: new Set(),
      heartbeatTimer: setInterval(() => {
        this.publish(instanceId, 'heartbeat', { timestamp: new Date().toISOString() })
      }, HEARTBEAT_MS),
    }

    this.buses.set(instanceId, bus)
    return bus
  }

  // --------------------------------------------------------
  // Public: publish helpers
  // --------------------------------------------------------

  /**
   * Publish a raw event to the instance bus.
   * Creates the bus if it doesn't exist yet.
   */
  publish(instanceId: string, type: SseEvent['type'], data: Record<string, unknown>): void {
    const bus = this.getOrCreateBus(instanceId)
    const event: SseEvent = {
      id: bus.nextId++,
      type,
      data,
    }

    // Ring buffer: drop oldest if full
    bus.buffer.push(event)
    if (bus.buffer.length > BUFFER_SIZE) {
      bus.buffer.shift()
    }

    // Notify all active listeners
    for (const listener of bus.listeners) {
      listener(event)
    }
  }

  /**
   * Publish a state_change event. If the instance has output_parameters,
   * also publish an output event with the current outputs.
   */
  publishStateChange(
    instanceId: string,
    state: string,
    previousState: string | null,
    instance: Instance
  ): void {
    this.publish(instanceId, 'state_change', {
      instance_id: instanceId,
      state,
      previous_state: previousState,
      timestamp: new Date().toISOString(),
    })

    // Publish output event if outputs are non-empty
    const outputs = instance.output_parameters as unknown[]
    if (outputs && outputs.length > 0) {
      this.publish(instanceId, 'output', {
        instance_id: instanceId,
        outputs: protocolPairs(outputs),
        timestamp: new Date().toISOString(),
      })
    }
  }

  /**
   * Publish terminal state: emits state_change, stops heartbeat,
   * schedules bus cleanup after TERMINAL_LINGER_MS.
   */
  publishTerminal(
    instanceId: string,
    state: string,
    previousState: string | null,
    instance: Instance
  ): void {
    this.publishStateChange(instanceId, state, previousState, instance)

    const bus = this.buses.get(instanceId)
    if (!bus) return

    // Stop heartbeat
    clearInterval(bus.heartbeatTimer)

    // Schedule bus deletion after linger period
    bus.terminalTimer = setTimeout(() => {
      this.buses.delete(instanceId)
    }, TERMINAL_LINGER_MS)
  }

  /**
   * Publish an error as a log event on stderr stream.
   */
  publishError(instanceId: string, message: string): void {
    this.publish(instanceId, 'log', {
      instance_id: instanceId,
      stream: 'stderr',
      message,
      timestamp: new Date().toISOString(),
    })
  }

  // --------------------------------------------------------
  // Public: subscription
  // --------------------------------------------------------

  /**
   * Subscribe to events for a specific instance. `onDestroy`, when given, is
   * invoked once by teardown (`destroyInstanceBus` / `shutdown`) so the route
   * holding the open HTTP response can end its stream instead of hanging
   * until the client times out; it is dropped (not called) if the caller
   * unsubscribes first.
   * Returns an unsubscribe function.
   */
  subscribe(
    instanceId: string,
    listener: (event: SseEvent) => void,
    onDestroy?: () => void
  ): () => void {
    const bus = this.getOrCreateBus(instanceId)
    bus.listeners.add(listener)
    if (onDestroy) bus.closers.add(onDestroy)

    return () => {
      bus.listeners.delete(listener)
      if (onDestroy) bus.closers.delete(onDestroy)
    }
  }

  /**
   * Return all buffered events after the given event id (for SSE reconnection replay).
   */
  getEventsSince(instanceId: string, afterId: number): SseEvent[] {
    const bus = this.buses.get(instanceId)
    if (!bus) return []
    return bus.buffer.filter((e) => e.id > afterId)
  }

  // --------------------------------------------------------
  // Property buses (per env_oid + property_name)
  // --------------------------------------------------------

  private readonly propertyBuses = new Map<
    string,
    {
      buffer: SseEvent[]
      nextId: number
      listeners: Set<(event: SseEvent) => void>
      closers: Set<() => void>
      heartbeatTimer: NodeJS.Timeout
    }
  >()

  private propertyKey(envOid: string, propertyName: string): string {
    return `${envOid}::${propertyName}`
  }

  private getOrCreatePropertyBus(envOid: string, propertyName: string) {
    const key = this.propertyKey(envOid, propertyName)
    const existing = this.propertyBuses.get(key)
    if (existing) return existing
    const bus = {
      buffer: [] as SseEvent[],
      nextId: 0,
      listeners: new Set<(event: SseEvent) => void>(),
      closers: new Set<() => void>(),
      heartbeatTimer: setInterval(() => {
        const ev: SseEvent = {
          id: bus.nextId++,
          type: 'heartbeat',
          data: { timestamp: new Date().toISOString() },
        }
        bus.buffer.push(ev)
        if (bus.buffer.length > BUFFER_SIZE) bus.buffer.shift()
        for (const l of bus.listeners) l(ev)
      }, HEARTBEAT_MS),
    }
    this.propertyBuses.set(key, bus)
    return bus
  }

  publishProperty(
    envOid: string,
    propertyName: string,
    data: {
      entries: Array<{ name: string; value: string }>
      changed_entries: string[]
      source: PropertyWriteSource
      source_action_oid?: string
      source_instance_id?: string
    }
  ): void {
    const bus = this.getOrCreatePropertyBus(envOid, propertyName)
    const event: SseEvent = {
      id: bus.nextId++,
      type: 'property',
      data: {
        environment_oid: envOid,
        property_name: propertyName,
        ...data,
        timestamp: new Date().toISOString(),
      },
    }
    bus.buffer.push(event)
    if (bus.buffer.length > BUFFER_SIZE) bus.buffer.shift()
    for (const l of bus.listeners) l(event)
  }

  subscribeProperty(
    envOid: string,
    propertyName: string,
    listener: (event: SseEvent) => void,
    onDestroy?: () => void
  ): () => void {
    const bus = this.getOrCreatePropertyBus(envOid, propertyName)
    bus.listeners.add(listener)
    if (onDestroy) bus.closers.add(onDestroy)
    return () => {
      bus.listeners.delete(listener)
      if (onDestroy) bus.closers.delete(onDestroy)
    }
  }

  getPropertyEventsSince(envOid: string, propertyName: string, afterId: number): SseEvent[] {
    const bus = this.propertyBuses.get(this.propertyKey(envOid, propertyName))
    if (!bus) return []
    return bus.buffer.filter((e) => e.id > afterId)
  }

  /** Run and drop every closer; a throwing closer never stops the others. */
  private runClosers(closers: Set<() => void>): void {
    for (const close of closers) {
      try {
        close()
      } catch {
        // a stream already ended by the client — nothing to do
      }
    }
    closers.clear()
  }

  /** Ends every open stream subscribed to this environment's property buses, then tears them down. */
  destroyPropertyBuses(envOid: string): void {
    for (const [key, bus] of this.propertyBuses) {
      if (key.startsWith(`${envOid}::`)) {
        clearInterval(bus.heartbeatTimer)
        this.runClosers(bus.closers)
        bus.listeners.clear()
        this.propertyBuses.delete(key)
      }
    }
  }

  /**
   * Immediately tear down the per-instance event bus: clears heartbeat + any
   * pending terminal-linger timer, drops every listener and ends every
   * subscriber's stream, and removes the bus entry. Called by the management
   * `DELETE /instances/:id` route so a force-deleted instance leaves no
   * lingering heartbeat or SSE subscribers referencing a row that no longer
   * exists. No-op if no bus is registered (typical for
   * terminal-then-linger-then-gc instances).
   */
  destroyInstanceBus(instanceId: string): void {
    const bus = this.buses.get(instanceId)
    if (!bus) return
    clearInterval(bus.heartbeatTimer)
    if (bus.terminalTimer) clearTimeout(bus.terminalTimer)
    this.runClosers(bus.closers)
    bus.listeners.clear()
    this.buses.delete(instanceId)
  }

  // --------------------------------------------------------
  // Public: shutdown
  // --------------------------------------------------------

  /**
   * Clear all timers and buses and end every subscriber's stream (called on
   * process shutdown).
   */
  shutdown(): void {
    for (const bus of this.buses.values()) {
      clearInterval(bus.heartbeatTimer)
      if (bus.terminalTimer) {
        clearTimeout(bus.terminalTimer)
      }
      this.runClosers(bus.closers)
    }
    this.buses.clear()
    for (const bus of this.propertyBuses.values()) {
      clearInterval(bus.heartbeatTimer)
      this.runClosers(bus.closers)
    }
    this.propertyBuses.clear()
  }
}

/**
 * Output pairs on the wire. Outputs are stored as `{key, value}`; the protocol names the field
 * `name` (REST_Protocol.md), so both are sent: `name` for protocol clients, `key` for existing
 * readers such as the console.
 */
export function protocolPairs(pairs: unknown): unknown[] {
  if (!Array.isArray(pairs)) return []
  return pairs.map((p) => {
    if (!p || typeof p !== 'object') return p
    const { key, name } = p as { key?: unknown; name?: unknown }
    return name === undefined && typeof key === 'string' ? { name: key, ...p } : p
  })
}
