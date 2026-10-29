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
import { describe, expect, it } from 'vitest'
import { EnvelopeParseError, parseWorkflowEnvelope } from '../parseEnvelope'
import { CURRENT_DATA_SCHEMA_VERSION } from '@/lib/data-schema-version'

const minimalEnvelope = (schemaVersion: string) =>
  JSON.stringify({
    schemaVersion,
    oid: 'WF1',
    local_id: 'wf',
    version: '1.0.0',
    last_modified_date: '2026-07-23T00:00:00.000Z',
    steps: [],
    connections: [],
  })

describe('parseWorkflowEnvelope version gate', () => {
  it('accepts 4.0 and 5.0', () => {
    expect(parseWorkflowEnvelope(minimalEnvelope('4.0')).specs).toHaveLength(1)
    expect(parseWorkflowEnvelope(minimalEnvelope('5.0')).specs).toHaveLength(1)
  })
  it('rejects below 4.0 (existing behavior)', () => {
    expect(() => parseWorkflowEnvelope(minimalEnvelope('3.0'))).toThrowError(EnvelopeParseError)
  })
  it('rejects ABOVE 5.0 loudly — a stale Mission Designer must not silently swallow a newer package', () => {
    try {
      parseWorkflowEnvelope(minimalEnvelope('6.0'))
      expect.unreachable('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(EnvelopeParseError)
      expect((e as EnvelopeParseError).code).toBe('unsupported_schema_version')
    }
  })
  it('stamps imported specs at the CURRENT data schema version', () => {
    expect(parseWorkflowEnvelope(minimalEnvelope('5.0')).specs[0].dataSchemaVersion).toBe(CURRENT_DATA_SCHEMA_VERSION)
    expect(CURRENT_DATA_SCHEMA_VERSION).toBe(4)
  })
})
