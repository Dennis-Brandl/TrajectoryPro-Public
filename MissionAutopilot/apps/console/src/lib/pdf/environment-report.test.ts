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
import { generateEnvironmentReportPDF } from './environment-report'
import type { EnvirBundle } from '../envir-bundle'

const FIXTURE: EnvirBundle = {
  manifest: {
    format: 'WFenvirBundleX',
    format_version: 1,
    exported_at: '2026-05-19T00:00:00.000Z',
    container_version: '1.0.0',
    environment_oid: 'env-oid',
    environment_local_id: 'KitchenLite',
    action_count: 2,
    code_file_count: 2,
  },
  environment: {
    oid: 'env-oid',
    local_id: 'KitchenLite',
    version: '1',
    description: 'Test env description',
    last_modified_date: '2026-05-19T00:00:00.000Z',
    action_property_specifications: [
      { id: 'PRINTER_HOST', value_type: 'string', default_value: '10.0.0.5', description: null },
    ],
  },
  actions: [
    {
      record: {
        oid: 'boil-oid',
        local_id: 'Boil',
        version: '1',
        action_visibility: 'observable',
        description: 'Boils water',
        input_parameter_specifications: [
          {
            id: 'temperature',
            value_type: 'number',
            default_value: '100',
            description: 'Target temp',
          },
        ],
        output_parameter_specifications: [
          { id: 'status', value_type: 'string', default_value: '0', description: null },
        ],
      },
      code: {
        STARTING: '# Boil STARTING\noutputs["status"] = "0"\n',
        EXECUTING: '# Boil EXECUTING\nimport time\ntime.sleep(0.01)\n',
      },
    },
    {
      record: {
        oid: 'chop-oid',
        local_id: 'Chop',
        version: '1',
        action_visibility: 'opaque',
        description: null,
        input_parameter_specifications: [],
        output_parameter_specifications: [
          { id: 'status', value_type: 'string', default_value: '0', description: null },
        ],
      },
      code: {},
    },
  ],
}

describe('generateEnvironmentReportPDF', () => {
  it('returns a Blob with PDF magic bytes', async () => {
    const blob = generateEnvironmentReportPDF(FIXTURE)
    expect(blob.type).toBe('application/pdf')
    expect(blob.size).toBeGreaterThan(1000)

    const buf = new Uint8Array(await blob.arrayBuffer())
    expect(String.fromCharCode(buf[0]!, buf[1]!, buf[2]!, buf[3]!, buf[4]!)).toBe('%PDF-')
  })

  it('embeds env local_id and action local_ids in the PDF stream', async () => {
    const blob = generateEnvironmentReportPDF(FIXTURE)
    const text = await blob.text()
    // jsPDF text streams are not always plain ASCII but env names are typically searchable.
    expect(text).toContain('KitchenLite')
    expect(text).toContain('Boil')
    expect(text).toContain('Chop')
  })

  it('handles actions with no code segments without throwing', () => {
    const noCode: EnvirBundle = {
      ...FIXTURE,
      actions: [{ ...FIXTURE.actions[1]! }], // Chop has empty code
    }
    expect(() => generateEnvironmentReportPDF(noCode)).not.toThrow()
  })
})
