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

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SseManager, type SseEvent } from '../sse-manager.js'

describe('SseManager — property bus', () => {
  let mgr: SseManager
  beforeEach(() => {
    mgr = new SseManager()
  })
  afterEach(() => mgr.shutdown())

  it('publishes property events to subscribers of the same (env_oid, property_name)', () => {
    const received: SseEvent[] = []
    const unsub = mgr.subscribeProperty('env-1', 'SIM_MODE', (ev) => received.push(ev))

    mgr.publishProperty('env-1', 'SIM_MODE', {
      entries: [{ name: 'Value', value: 'true' }],
      changed_entries: ['Value'],
      source: 'action_code',
      source_action_oid: 'act-1',
      source_instance_id: 'ai-1',
    })

    expect(received).toHaveLength(1)
    expect(received[0].type).toBe('property')
    expect(received[0].data.property_name).toBe('SIM_MODE')
    expect(received[0].data.environment_oid).toBe('env-1')
    expect(received[0].data.changed_entries).toEqual(['Value'])
    unsub()
  })

  it('isolates property buses by (env_oid, property_name)', () => {
    const received: SseEvent[] = []
    mgr.subscribeProperty('env-1', 'SIM_MODE', (ev) => received.push(ev))

    mgr.publishProperty('env-2', 'SIM_MODE', {
      entries: [],
      changed_entries: [],
      source: 'action_code',
    })
    mgr.publishProperty('env-1', 'OTHER', {
      entries: [],
      changed_entries: [],
      source: 'action_code',
    })

    expect(received).toHaveLength(0)
  })

  it('replays buffered property events via getPropertyEventsSince', () => {
    mgr.publishProperty('env-1', 'X', { entries: [], changed_entries: [], source: 'action_code' })
    mgr.publishProperty('env-1', 'X', { entries: [], changed_entries: [], source: 'action_code' })
    const events = mgr.getPropertyEventsSince('env-1', 'X', -1)
    expect(events).toHaveLength(2)
    expect(events[0].id).toBe(0)
    expect(events[1].id).toBe(1)
  })

  it('destroys property buses for an env on destroyPropertyBuses', () => {
    const received: SseEvent[] = []
    mgr.subscribeProperty('env-1', 'X', (ev) => received.push(ev))
    mgr.destroyPropertyBuses('env-1')
    mgr.publishProperty('env-1', 'X', { entries: [], changed_entries: [], source: 'action_code' })
    expect(received).toHaveLength(0)
  })
})
