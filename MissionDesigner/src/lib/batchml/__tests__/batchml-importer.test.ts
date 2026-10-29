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
import { importBatchml, BatchmlImportError } from '../batchml-importer'
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

describe('importBatchml', () => {
  it('recovers the exact canonical spec from a Designer-authored file', () => {
    const xml = exportBatchml(spec)
    const recovered = importBatchml(xml)
    expect(recovered).toEqual(spec)
  })

  it('accepts a legacy file carrying the TrajectoryProStudio: payload prefix (permanent)', () => {
    // A faithful pre-2026-09-11 export: same document, old marker on the wire.
    const legacyXml = exportBatchml(spec).replace(
      'MissionDesigner:CanonicalSpec/1.0',
      'TrajectoryProStudio:CanonicalSpec/1.0',
    )
    expect(legacyXml).toContain('TrajectoryProStudio:CanonicalSpec/1.0')
    expect(importBatchml(legacyXml)).toEqual(spec)
  })

  it('throws a typed error for a foreign BatchML file (no payload)', () => {
    const foreign =
      '<?xml version="1.0"?>\n<MasterRecipe xmlns="http://www.mesa.org/xml/B2MML"><ID>Foreign</ID></MasterRecipe>'
    expect(() => importBatchml(foreign)).toThrow(BatchmlImportError)
  })

  it('throws for a non-BatchML document', () => {
    expect(() => importBatchml('<html></html>')).toThrow(BatchmlImportError)
  })

  it('names the legacy payload id when a legacy file is the corrupt one', () => {
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<MasterRecipe>',
      '  <OtherInformation>',
      '    <ID>TrajectoryProStudio:CanonicalSpec/1.0</ID>',
      '  </OtherInformation>',
      '</MasterRecipe>',
    ].join('\n')

    expect(() => importBatchml(xml)).toThrowError('Corrupt TrajectoryProStudio:CanonicalSpec/1.0 payload: no value.')
  })
})
