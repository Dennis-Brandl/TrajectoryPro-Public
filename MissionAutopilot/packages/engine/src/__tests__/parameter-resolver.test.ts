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

/**
 * parameter-resolver.test.ts — Unit tests for resolveInputParameters and flattenProperties.
 */

import { describe, it, expect } from 'vitest'
import {
  resolveInputParameters,
  flattenProperties,
  mergePropertyOverrides,
} from '../instance-manager/parameter-resolver.js'
import { EngineError } from '../errors.js'

// ============================================================
// resolveInputParameters
// ============================================================

describe('resolveInputParameters', () => {
  it('returns provided parameters matched to specs', () => {
    const provided = [
      { name: 'foo', value: 'hello' },
      { name: 'bar', value: '42' },
    ]
    const specs = [{ id: 'foo' }, { id: 'bar' }]

    const result = resolveInputParameters(provided, specs)

    expect(result).toEqual([
      { key: 'foo', value: 'hello' },
      { key: 'bar', value: '42' },
    ])
  })

  it('fills defaults for missing parameters when default_value exists on spec', () => {
    const provided: Array<{ name: string; value: string }> = []
    const specs = [
      { id: 'timeout', default_value: '30' },
      { id: 'retries', default_value: '3' },
    ]

    const result = resolveInputParameters(provided, specs)

    expect(result).toEqual([
      { key: 'timeout', value: '30' },
      { key: 'retries', value: '3' },
    ])
  })

  it('throws EngineError PARAMETER_VALIDATION_FAILED when required parameter is missing and has no default', () => {
    const provided: Array<{ name: string; value: string }> = []
    const specs = [{ id: 'required_param' }]

    expect(() => resolveInputParameters(provided, specs)).toThrow(EngineError)
    expect(() => resolveInputParameters(provided, specs)).toThrowError(
      expect.objectContaining({ code: 'PARAMETER_VALIDATION_FAILED' })
    )
  })

  it('passes through extra parameters not in specs', () => {
    const provided = [
      { name: 'known', value: 'value' },
      { name: 'extra_param', value: 'extra_value' },
    ]
    const specs = [{ id: 'known' }]

    const result = resolveInputParameters(provided, specs)

    expect(result).toContainEqual({ key: 'known', value: 'value' })
    expect(result).toContainEqual({ key: 'extra_param', value: 'extra_value' })
    expect(result).toHaveLength(2)
  })

  it('handles empty specs array (passes through all provided)', () => {
    const provided = [
      { name: 'a', value: '1' },
      { name: 'b', value: '2' },
    ]
    const specs: unknown[] = []

    const result = resolveInputParameters(provided, specs)

    expect(result).toEqual([
      { key: 'a', value: '1' },
      { key: 'b', value: '2' },
    ])
  })

  it('handles empty provided array with all defaults', () => {
    const provided: Array<{ name: string; value: string }> = []
    const specs = [
      { id: 'x', default_value: '10' },
      { id: 'y', default_value: '20' },
    ]

    const result = resolveInputParameters(provided, specs)

    expect(result).toEqual([
      { key: 'x', value: '10' },
      { key: 'y', value: '20' },
    ])
  })

  it('prefers provided value over default when both are available', () => {
    const provided = [{ name: 'timeout', value: '60' }]
    const specs = [{ id: 'timeout', default_value: '30' }]

    const result = resolveInputParameters(provided, specs)

    expect(result).toEqual([{ key: 'timeout', value: '60' }])
  })
})

// ============================================================
// flattenProperties
// ============================================================

describe('flattenProperties', () => {
  it('flattens nested property specs to Record<string, Record<string, string>>', () => {
    const specs = [
      {
        name: 'connection',
        entries: [
          { name: 'host', value: 'localhost' },
          { name: 'port', value: '5432' },
        ],
      },
      {
        name: 'auth',
        entries: [{ name: 'token', value: 'secret' }],
      },
    ]

    const result = flattenProperties(specs)

    expect(result).toEqual({
      connection: { host: 'localhost', port: '5432' },
      auth: { token: 'secret' },
    })
  })

  it('returns empty object for empty array input', () => {
    expect(flattenProperties([])).toEqual({})
  })

  it('returns empty object for null/undefined-like empty specs', () => {
    // Empty array is the standard "no specs" representation
    expect(flattenProperties([])).toEqual({})
  })

  it('handles specs with empty entries arrays', () => {
    const specs = [{ name: 'empty_group', entries: [] }]

    const result = flattenProperties(specs)

    expect(result).toEqual({ empty_group: {} })
  })

  it('handles single spec with multiple entries', () => {
    const specs = [
      {
        name: 'settings',
        entries: [
          { name: 'debug', value: 'true' },
          { name: 'log_level', value: 'info' },
          { name: 'max_retries', value: '5' },
        ],
      },
    ]

    const result = flattenProperties(specs)

    expect(result).toEqual({
      settings: {
        debug: 'true',
        log_level: 'info',
        max_retries: '5',
      },
    })
  })
})

// ============================================================
// mergePropertyOverrides
// ============================================================

describe('mergePropertyOverrides', () => {
  it('returns the base unchanged when overrides is empty', () => {
    const base = { SIMULATION_MODE: { Value: 'false', Description: 'orig' } }
    const merged = mergePropertyOverrides(base, {})
    expect(merged).toEqual(base)
    // New object, not the same reference
    expect(merged).not.toBe(base)
    expect(merged.SIMULATION_MODE).not.toBe(base.SIMULATION_MODE)
  })

  it('overrides existing entry values', () => {
    const base = { SIMULATION_MODE: { Value: 'false', Description: 'orig' } }
    const merged = mergePropertyOverrides(base, {
      SIMULATION_MODE: { Value: 'true' },
    })
    expect(merged.SIMULATION_MODE).toEqual({ Value: 'true', Description: 'orig' })
  })

  it('adds new entries under an existing spec', () => {
    const base = { SIMULATION_MODE: { Value: 'false' } }
    const merged = mergePropertyOverrides(base, {
      SIMULATION_MODE: { Description: 'added later' },
    })
    expect(merged.SIMULATION_MODE).toEqual({ Value: 'false', Description: 'added later' })
  })

  it('adds entirely new spec keys', () => {
    const base = { SIMULATION_MODE: { Value: 'false' } }
    const merged = mergePropertyOverrides(base, {
      DEBUG_MODE: { Value: 'true' },
    })
    expect(merged).toEqual({
      SIMULATION_MODE: { Value: 'false' },
      DEBUG_MODE: { Value: 'true' },
    })
  })

  it('does not mutate either argument', () => {
    const base = { SIMULATION_MODE: { Value: 'false' } }
    const overrides = { SIMULATION_MODE: { Value: 'true' } }
    mergePropertyOverrides(base, overrides)
    expect(base.SIMULATION_MODE.Value).toBe('false')
    expect(overrides.SIMULATION_MODE.Value).toBe('true')
  })
})
