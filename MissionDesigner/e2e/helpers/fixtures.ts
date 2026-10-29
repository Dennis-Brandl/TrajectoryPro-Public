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

import type { ResourceType } from '../../src/types/nodes'

export interface InputFixture {
  name: string
  value: string
  valueType: 'literal' | 'property'
  description?: string
  propertySource?: string // e.g. 'Workflow Input:rootIn1' — semantic label of the source
}

export interface OutputFixture {
  name: string
  description?: string
}

export interface ValueFixture {
  name: string
  entries: Array<{ key: string; value: string }>
}

export interface ResourceFixture {
  name: string
  resourceType: ResourceType
  count: number
  names?: string[]
  description?: string
}

export interface DepthFixture {
  inputs: InputFixture[]
  outputs: OutputFixture[]
  values: ValueFixture[]
  resources: ResourceFixture[]
}

/**
 * Variety matrix applied to every nested chain.
 * Keys 0–3 correspond to Root / L1 / L2 / L3.
 */
export const PARAMETER_MATRIX: Record<0 | 1 | 2 | 3, DepthFixture> = {
  0: {
    inputs: [
      { name: 'rootIn1', value: 'hello', valueType: 'literal' },
      { name: 'rootIn2', value: '42', valueType: 'literal' },
    ],
    outputs: [{ name: 'rootOut1' }, { name: 'rootOut2' }],
    values: [],
    resources: [],
  },
  1: {
    inputs: [
      { name: 'l1_lit_a', value: 'foo', valueType: 'literal' },
      { name: 'l1_lit_b', value: 'bar', valueType: 'literal' },
      { name: 'l1_src', value: '', valueType: 'property', propertySource: 'rootIn1' },
    ],
    outputs: [{ name: 'l1Out1' }, { name: 'l1Out2' }],
    values: [
      {
        name: 'l1Val1',
        entries: [
          { key: 'k1', value: 'v1' },
          { key: 'k2', value: 'v2' },
        ],
      },
    ],
    resources: [],
  },
  2: {
    inputs: [{ name: 'l2In', value: 'xyz', valueType: 'literal' }],
    outputs: [{ name: 'l2Out' }],
    values: [{ name: 'l2Val', entries: [{ key: 'k1', value: 'v1' }] }],
    resources: [{ name: 'l2Res', resourceType: 'Single Use', count: 1 }],
  },
  3: {
    inputs: [
      { name: 'l3In1', value: 'a', valueType: 'literal' },
      { name: 'l3In2', value: '', valueType: 'property', propertySource: 'l2Out' },
    ],
    outputs: [{ name: 'l3Out1' }, { name: 'l3Out2' }],
    values: [
      { name: 'l3Val1', entries: [{ key: 'k1', value: 'v1' }] },
      { name: 'l3Val2', entries: [{ key: 'k2', value: 'v2' }] },
    ],
    resources: [
      { name: 'l3_single', resourceType: 'Single Use', count: 1 },
      { name: 'l3_shared', resourceType: 'Shared Use', count: 3 },
      { name: 'l3_count', resourceType: 'Count Limited', count: 5 },
      { name: 'l3_named', resourceType: 'Named', count: 3, names: ['a', 'b', 'c'] },
      { name: 'l3_sync', resourceType: 'Sync', count: 1 },
    ],
  },
}

export const LIBRARY_NAMES = ['E2E Step Lib 1', 'E2E Step Lib 2', 'E2E Step Lib 3'] as const

export const SUB_LIBRARY_NAME = 'E2E Sub-Lib'

/** Workflow name for library index (1-based) and workflow index (1-based). */
export function workflowName(libIdx: number, wfIdx: number): string {
  return `WF ${libIdx}-${wfIdx}`
}

/** Child name for a given depth (1=L1, 2=L2, 3=L3). */
export function childName(depth: 1 | 2 | 3): string {
  return `Child L${depth}`
}
