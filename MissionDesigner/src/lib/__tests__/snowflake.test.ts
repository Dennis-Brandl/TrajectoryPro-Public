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
  generateOID,
  extractWorkerId,
  WORKER_INTERNAL,
  WORKER_ACTION,
  WORKER_STEP,
  WORKER_WORKFLOW,
} from '../snowflake'

describe('Snowflake OID Generator', () => {
  it('generates unique IDs for the same worker', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 1000; i++) {
      ids.add(generateOID(WORKER_STEP))
    }
    expect(ids.size).toBe(1000)
  })

  it('generates unique IDs across different workers', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 100; i++) {
      ids.add(generateOID(WORKER_INTERNAL))
      ids.add(generateOID(WORKER_ACTION))
      ids.add(generateOID(WORKER_STEP))
      ids.add(generateOID(WORKER_WORKFLOW))
    }
    expect(ids.size).toBe(400)
  })

  it('generates monotonically increasing IDs for same worker', () => {
    const ids: bigint[] = []
    for (let i = 0; i < 100; i++) {
      ids.push(BigInt(generateOID(WORKER_STEP)))
    }
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i]).toBeGreaterThan(ids[i - 1])
    }
  })

  it('encodes the correct worker ID', () => {
    expect(extractWorkerId(generateOID(WORKER_INTERNAL))).toBe(0)
    expect(extractWorkerId(generateOID(WORKER_ACTION))).toBe(1)
    expect(extractWorkerId(generateOID(WORKER_STEP))).toBe(5)
    expect(extractWorkerId(generateOID(WORKER_WORKFLOW))).toBe(7)
  })

  it('returns string representation', () => {
    const oid = generateOID(WORKER_STEP)
    expect(typeof oid).toBe('string')
    // Should be parseable as BigInt
    expect(() => BigInt(oid)).not.toThrow()
  })

  it('handles sequence overflow within same millisecond', () => {
    // Generate many IDs rapidly (should not throw or produce duplicates)
    const ids = new Set<string>()
    for (let i = 0; i < 5000; i++) {
      ids.add(generateOID(WORKER_INTERNAL))
    }
    expect(ids.size).toBe(5000)
  })
})
