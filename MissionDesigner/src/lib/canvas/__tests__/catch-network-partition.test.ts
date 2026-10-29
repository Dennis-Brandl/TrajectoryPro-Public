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
import { partitionCatchNetworks } from '../catch-network-partition'

const steps = [
  { oid: 's1', step_type: 'START' },
  { oid: 's2', step_type: 'ACTION PROXY' },
  { oid: 's3', step_type: 'END' },
  { oid: 'c1', step_type: 'CATCH', catch_id: 'C1' },
  { oid: 'r1', step_type: 'RETURN' },
]
const conns = [
  { from_step_id: 's1', to_step_id: 's2' },
  { from_step_id: 's2', to_step_id: 's3' },
  { from_step_id: 'c1', to_step_id: 'r1' },
]
describe('partitionCatchNetworks', () => {
  it('separates a catch island (reaching RETURN) from main flow', () => {
    const p = partitionCatchNetworks(steps, conns)
    expect([...p.catchNetworkStepOids].sort()).toEqual(['c1', 'r1'])
    expect([...p.mainFlowStepOids].sort()).toEqual(['s1', 's2', 's3'])
    expect([...(p.networksByCatchId.get('C1') ?? [])].sort()).toEqual(['c1', 'r1'])
  })
  it('does NOT count a CATCH island with no reachable RETURN', () => {
    const p = partitionCatchNetworks(
      [
        { oid: 'c1', step_type: 'CATCH', catch_id: 'C1' },
        { oid: 'u1', step_type: 'USER_INTERACTION' },
      ],
      [{ from_step_id: 'c1', to_step_id: 'u1' }],
    )
    expect(p.catchNetworkStepOids.size).toBe(0)
  })
})
