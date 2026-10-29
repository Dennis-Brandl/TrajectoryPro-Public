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
import { exportBatchml } from '../batchml-exporter'
import { fromBase64Utf8 } from '../base64'
import { parseBatchmlXml } from '../xml-serializer'
import type { MasterWorkflowSpecification } from '@/lib/packageFormat/export-types'

const spec: MasterWorkflowSpecification = {
  oid: 'wf',
  local_id: 'Demo',
  version: '1.0.0',
  last_modified_date: '2026-01-01T00:00:00Z',
  steps: [
    { oid: 's1', local_id: 'Start', version: '1.0.0', last_modified_date: '2026-01-01T00:00:00Z', step_type: 'START' },
  ],
  connections: [],
}

describe('exportBatchml', () => {
  it('embeds the canonical spec as a base64 OtherInformation payload', () => {
    const xml = exportBatchml(spec)
    const parsed = parseBatchmlXml(xml) as { MasterRecipe: { OtherInformation: unknown } }
    const others = ([] as Array<{ ID?: string; Value?: Array<{ ValueString?: string }> }>).concat(
      parsed.MasterRecipe.OtherInformation as never,
    )
    const payload = others.find((o) => o.ID === 'MissionDesigner:CanonicalSpec/1.0')
    expect(payload).toBeTruthy()
    expect(others.some((o) => o.ID === 'MissionDesigner:Producer')).toBe(true)
    const decoded = JSON.parse(fromBase64Utf8(payload!.Value![0].ValueString!))
    expect(decoded.oid).toBe('wf')
    expect(decoded.local_id).toBe('Demo')
  })
})
