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

import { describe, it, expect } from 'vitest'
import {
  initialStateFromInstance,
  instanceStreamReducer,
} from './instance-stream-reducer'
import type { Instance, InstanceLiveState, SseEventWire } from '../api/types'

const seedInstance: Instance = {
  instance_id: 'inst-1',
  action_oid: 'act-1',
  environment_oid: 'env-1',
  workflow_instance_id: 'wf-1',
  step_instance_id: 'step-1',
  step_oid: 'stepoid-1',
  visibility: 'observable',
  state: { current: 'STARTING', previous: null, entered_at: '2026-05-14T00:00:00Z' },
  inputs: [],
  outputs: [],
  created_at: '2026-05-14T00:00:00Z',
  started_at: '2026-05-14T00:00:00Z',
  completed_at: null,
  error: null,
}

describe('initialStateFromInstance', () => {
  it('seeds current_state and one history entry', () => {
    const live = initialStateFromInstance(seedInstance)
    expect(live.instance_id).toBe('inst-1')
    expect(live.current_state).toBe('STARTING')
    expect(live.state_history).toHaveLength(1)
    expect(live.state_history[0]).toMatchObject({
      state: 'STARTING',
      entered_at: '2026-05-14T00:00:00Z',
    })
    expect(live.terminal).toBe(false)
    expect(live.terminal_error).toBeNull()
    expect(live.outputs).toEqual({})
    expect(live.last_event_id).toBe(-1)
  })

  it('seeds two history entries when previous state is set', () => {
    const live = initialStateFromInstance({
      ...seedInstance,
      state: {
        current: 'EXECUTING',
        previous: 'STARTING',
        entered_at: '2026-05-14T00:01:00Z',
      },
      started_at: '2026-05-14T00:00:00Z',
    })
    expect(live.state_history.map((e) => e.state)).toEqual(['STARTING', 'EXECUTING'])
    expect(live.state_history[0].duration_ms).toBe(60_000)
    expect(live.state_history[1].duration_ms).toBeUndefined()
  })

  it('seeds terminal_error from instance.error', () => {
    const live = initialStateFromInstance({ ...seedInstance, error: 'boom', state: { ...seedInstance.state, current: 'ABORTED' } })
    expect(live.terminal_error).toBe('boom')
    expect(live.terminal).toBe(true)
  })

  it('seeds outputs as key-value record', () => {
    const live = initialStateFromInstance({
      ...seedInstance,
      outputs: [
        { key: 'status', value: '0' },
        { key: 'detail', value: 'ok' },
      ],
    })
    expect(live.outputs).toEqual({ status: '0', detail: 'ok' })
  })
})

describe('instanceStreamReducer — state_change', () => {
  it('appends a new history entry and finalizes the previous duration', () => {
    const prev = initialStateFromInstance(seedInstance) // STARTING @ T0
    const event: SseEventWire = {
      id: 0,
      type: 'state_change',
      data: {
        instance_id: 'inst-1',
        state: 'EXECUTING',
        previous_state: 'STARTING',
        timestamp: '2026-05-14T00:00:30Z',
      },
    }
    const next = instanceStreamReducer(prev, event)
    expect(next.current_state).toBe('EXECUTING')
    expect(next.state_history).toHaveLength(2)
    expect(next.state_history[0].duration_ms).toBe(30_000)
    expect(next.state_history[1]).toMatchObject({
      state: 'EXECUTING',
      entered_at: '2026-05-14T00:00:30Z',
    })
    expect(next.last_event_id).toBe(0)
  })

  it('marks terminal when entering COMPLETED', () => {
    const prev = initialStateFromInstance(seedInstance)
    const event: SseEventWire = {
      id: 1,
      type: 'state_change',
      data: {
        instance_id: 'inst-1',
        state: 'COMPLETED',
        previous_state: 'COMPLETING',
        timestamp: '2026-05-14T00:01:00Z',
      },
    }
    const next = instanceStreamReducer(prev, event)
    expect(next.terminal).toBe(true)
  })

  it('marks terminal when entering ABORTED', () => {
    const prev = initialStateFromInstance(seedInstance)
    const event: SseEventWire = {
      id: 1,
      type: 'state_change',
      data: {
        instance_id: 'inst-1',
        state: 'ABORTED',
        previous_state: 'ABORTING',
        timestamp: '2026-05-14T00:01:00Z',
      },
    }
    const next = instanceStreamReducer(prev, event)
    expect(next.terminal).toBe(true)
  })

  it('ignores stale events (id <= last_event_id)', () => {
    const prev = { ...initialStateFromInstance(seedInstance), last_event_id: 5 }
    const event: SseEventWire = {
      id: 5,
      type: 'state_change',
      data: {
        instance_id: 'inst-1',
        state: 'EXECUTING',
        previous_state: 'STARTING',
        timestamp: '2026-05-14T00:00:30Z',
      },
    }
    const next = instanceStreamReducer(prev, event)
    expect(next).toBe(prev)
  })
})

describe('instanceStreamReducer — output', () => {
  it('merges outputs into the record', () => {
    const prev = initialStateFromInstance(seedInstance)
    const event: SseEventWire = {
      id: 1,
      type: 'output',
      data: {
        instance_id: 'inst-1',
        outputs: [
          { key: 'status', value: '0' },
          { key: 'detail', value: 'ok' },
        ],
        timestamp: '2026-05-14T00:00:10Z',
      },
    }
    const next = instanceStreamReducer(prev, event)
    expect(next.outputs).toEqual({ status: '0', detail: 'ok' })
    expect(next.last_event_id).toBe(1)
  })

  it('overwrites existing keys without dropping unmentioned ones', () => {
    const prev: InstanceLiveState = {
      ...initialStateFromInstance(seedInstance),
      outputs: { status: 'pending', extra: 'keep' },
    }
    const event: SseEventWire = {
      id: 1,
      type: 'output',
      data: {
        instance_id: 'inst-1',
        outputs: [{ key: 'status', value: '0' }],
        timestamp: '2026-05-14T00:00:10Z',
      },
    }
    const next = instanceStreamReducer(prev, event)
    expect(next.outputs).toEqual({ status: '0', extra: 'keep' })
  })
})

describe('instanceStreamReducer — log', () => {
  it('records stderr messages as latest_error', () => {
    const prev = initialStateFromInstance(seedInstance)
    const event: SseEventWire = {
      id: 1,
      type: 'log',
      data: {
        instance_id: 'inst-1',
        stream: 'stderr',
        message: 'NameError: x is not defined',
        timestamp: '2026-05-14T00:00:10Z',
      },
    }
    const next = instanceStreamReducer(prev, event)
    expect(next.latest_error).toBe('NameError: x is not defined')
    expect(next.last_event_id).toBe(1)
  })

  it('extracts traceback when stderr includes it', () => {
    const prev = initialStateFromInstance(seedInstance)
    const event: SseEventWire = {
      id: 1,
      type: 'log',
      data: {
        instance_id: 'inst-1',
        stream: 'stderr',
        message:
          'Traceback (most recent call last):\n  File "x.py", line 1\nNameError: x is not defined',
        timestamp: '2026-05-14T00:00:10Z',
      },
    }
    const next = instanceStreamReducer(prev, event)
    expect(next.latest_traceback).toContain('Traceback (most recent call last):')
    expect(next.latest_error).toBe(
      'Traceback (most recent call last):\n  File "x.py", line 1\nNameError: x is not defined'
    )
  })

  it('ignores stdout log events for latest_error', () => {
    const prev = initialStateFromInstance(seedInstance)
    const event: SseEventWire = {
      id: 1,
      type: 'log',
      data: {
        instance_id: 'inst-1',
        stream: 'stdout',
        message: 'hello',
        timestamp: '2026-05-14T00:00:10Z',
      },
    }
    const next = instanceStreamReducer(prev, event)
    expect(next.latest_error).toBeUndefined()
    expect(next.last_event_id).toBe(1)
  })
})

describe('instanceStreamReducer — heartbeat', () => {
  it('advances last_event_id but otherwise no-ops', () => {
    const prev = initialStateFromInstance(seedInstance)
    const event: SseEventWire = {
      id: 1,
      type: 'heartbeat',
      data: { timestamp: '2026-05-14T00:00:10Z' },
    }
    const next = instanceStreamReducer(prev, event)
    expect(next.current_state).toBe(prev.current_state)
    expect(next.outputs).toBe(prev.outputs)
    expect(next.state_history).toBe(prev.state_history)
    expect(next.last_event_id).toBe(1)
  })
})
