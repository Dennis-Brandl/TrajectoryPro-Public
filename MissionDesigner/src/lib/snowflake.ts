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
 * Snowflake OID generator.
 *
 * 64-bit integer (stored as string):
 *   [1-bit sign=0][41-bit timestamp ms][10-bit worker][12-bit sequence]
 *
 * Custom epoch: 2024-01-01T00:00:00Z (1704067200000 ms)
 */

const CUSTOM_EPOCH = 1704067200000n
const WORKER_BITS = 10n
const SEQUENCE_BITS = 12n
const MAX_SEQUENCE = (1n << SEQUENCE_BITS) - 1n // 4095

// Worker Node IDs
export const WORKER_INTERNAL = 0 // sub-elements (params, values, options, UI blocks, resources, edges)
export const WORKER_ACTION = 1 // action specifications
export const WORKER_ACTION_LIBRARY = 2 // action libraries
export const WORKER_ENVIRONMENT = 3 // environment specifications
export const WORKER_ENVIRONMENT_LIBRARY = 4 // environment libraries
export const WORKER_STEP = 5 // steps (workflow nodes)
export const WORKER_STEP_LIBRARY = 6 // step libraries
export const WORKER_WORKFLOW = 7 // workflow specifications/metadata
export const WORKER_WORKFLOW_LIBRARY = 8 // workflow libraries

// Per-worker state for last timestamp and sequence counter
const workerState = new Map<number, { lastTimestamp: bigint; sequence: bigint }>()

/**
 * Generates a globally unique Snowflake OID as a string.
 *
 * @param workerId - Worker node ID (0-8) encoding the entity type.
 * @returns A string representation of the 64-bit snowflake ID.
 */
export function generateOID(workerId: number): string {
  const workerIdBig = BigInt(workerId)

  let state = workerState.get(workerId)
  if (!state) {
    state = { lastTimestamp: 0n, sequence: 0n }
    workerState.set(workerId, state)
  }

  let now = BigInt(Date.now()) - CUSTOM_EPOCH

  // Clock-backward guard: wait until clock catches up
  if (now < state.lastTimestamp) {
    now = state.lastTimestamp
  }

  if (now === state.lastTimestamp) {
    state.sequence = (state.sequence + 1n) & MAX_SEQUENCE
    if (state.sequence === 0n) {
      // Sequence overflow within same millisecond — advance timestamp
      now = state.lastTimestamp + 1n
    }
  } else {
    state.sequence = 0n
  }

  state.lastTimestamp = now

  const id = (now << (WORKER_BITS + SEQUENCE_BITS)) | (workerIdBig << SEQUENCE_BITS) | state.sequence

  return id.toString()
}

/**
 * Extracts the worker ID from a Snowflake OID string.
 *
 * @param oid - A string representation of a snowflake ID.
 * @returns The worker node ID (0-8).
 */
export function extractWorkerId(oid: string): number {
  const id = BigInt(oid)
  return Number((id >> SEQUENCE_BITS) & ((1n << WORKER_BITS) - 1n))
}
