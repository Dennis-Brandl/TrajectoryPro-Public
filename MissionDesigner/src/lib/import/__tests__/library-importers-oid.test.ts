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

// Regression: importing an Action or Environment library MUST preserve the
// source spec OID. The Editor stores a spec's identity as its `id`, which the
// exporter writes back as the `oid`. If import regenerates it, a workflow whose
// action-proxy references the original env/action OID can no longer bind it at
// runtime ("No server bound for environment <oid>").

import { describe, it, expect } from 'vitest'
import { importEnvironmentLibrary, importActionLibrary } from '../library-importers'

function envLibrary(specOid: string) {
  return {
    local_id: 'EnvLib',
    oid: 'lib-oid',
    version: '1.0.0',
    last_modified_date: '2026-01-01T00:00:00.000Z',
    environment_specifications: [
      {
        local_id: 'My Env',
        oid: specOid,
        version: '1.0.0',
        last_modified_date: '2026-01-01T00:00:00.000Z',
        included_actions: [],
        value_property_specifications: [],
        action_property_specifications: [],
      },
    ],
  }
}

function actionLibrary(specOid: string) {
  return {
    local_id: 'ActLib',
    oid: 'lib-oid',
    version: '1.0.0',
    last_modified_date: '2026-01-01T00:00:00.000Z',
    action_specifications: [
      {
        local_id: 'My Action',
        oid: specOid,
        version: '1.0.0',
        last_modified_date: '2026-01-01T00:00:00.000Z',
        input_parameter_specifications: [],
        output_parameter_specifications: [],
        property_specifications: [],
      },
    ],
  }
}

describe('library import preserves source OIDs (Actions + Environments)', () => {
  it('importEnvironmentLibrary keeps the environment spec oid as the spec id', () => {
    const result = importEnvironmentLibrary(envLibrary('env-oid-keep-me'))
    expect('error' in result).toBe(false)
    if ('error' in result) return
    expect(result.specifications[0].id).toBe('env-oid-keep-me')
  })

  it('importActionLibrary keeps the action spec oid as the spec id', () => {
    const result = importActionLibrary(actionLibrary('action-oid-keep-me'))
    expect('error' in result).toBe(false)
    if ('error' in result) return
    expect(result.specifications[0].id).toBe('action-oid-keep-me')
  })
})
