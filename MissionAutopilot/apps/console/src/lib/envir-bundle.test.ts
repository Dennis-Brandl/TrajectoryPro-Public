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
import JSZip from 'jszip'
import { parseEnvirBundle, type EnvirBundle } from './envir-bundle'

async function buildFixtureBundle(): Promise<Blob> {
  const zip = new JSZip()
  zip.file(
    'manifest.json',
    JSON.stringify({
      format: 'WFenvirBundleX',
      format_version: 1,
      exported_at: '2026-05-19T00:00:00.000Z',
      container_version: '1.0.0',
      environment_oid: 'env-oid',
      environment_local_id: 'TestEnv',
      action_count: 1,
      code_file_count: 1,
    })
  )
  zip.file(
    'TestEnv.WFenvir',
    JSON.stringify({
      local_id: 'TestEnv',
      oid: 'env-oid',
      version: '1',
      environment_specifications: [
        {
          oid: 'env-oid',
          local_id: 'TestEnv',
          version: '1',
          description: null,
          last_modified_date: null,
          action_property_specifications: [],
          included_actions: [
            {
              oid: 'action-oid',
              local_id: 'TestAction',
              version: '1',
              description: null,
              action_visibility: 'observable',
              input_parameter_specifications: [],
              output_parameter_specifications: [],
            },
          ],
        },
      ],
    })
  )
  zip.file('code/action-oid/STARTING.py', '# starting code\n')
  const blob = await zip.generateAsync({ type: 'blob' })
  return blob
}

describe('parseEnvirBundle', () => {
  it('parses manifest + inner .WFenvir + code into EnvirBundle', async () => {
    const blob = await buildFixtureBundle()
    const bundle: EnvirBundle = await parseEnvirBundle(blob)

    expect(bundle.manifest.format).toBe('WFenvirBundleX')
    expect(bundle.manifest.environment_oid).toBe('env-oid')

    expect(bundle.environment.local_id).toBe('TestEnv')

    expect(bundle.actions).toHaveLength(1)
    expect(bundle.actions[0].record.local_id).toBe('TestAction')
    expect(bundle.actions[0].code.STARTING).toBe('# starting code\n')
  })

  it('throws on missing manifest.json', async () => {
    const zip = new JSZip()
    zip.file('TestEnv.WFenvir', '{}')
    const blob = await zip.generateAsync({ type: 'blob' })
    await expect(parseEnvirBundle(blob)).rejects.toThrow(/manifest\.json/)
  })

  it('throws on missing inner .WFenvir', async () => {
    const zip = new JSZip()
    zip.file('manifest.json', JSON.stringify({ format: 'WFenvirBundleX', format_version: 1 }))
    const blob = await zip.generateAsync({ type: 'blob' })
    await expect(parseEnvirBundle(blob)).rejects.toThrow(/\.WFenvir/)
  })

  it('throws on empty environment_specifications array', async () => {
    const zip = new JSZip()
    zip.file('manifest.json', JSON.stringify({ format: 'WFenvirBundleX', format_version: 1 }))
    zip.file('Empty.WFenvir', JSON.stringify({ environment_specifications: [] }))
    const blob = await zip.generateAsync({ type: 'blob' })
    await expect(parseEnvirBundle(blob)).rejects.toThrow(/environment/i)
  })
})
