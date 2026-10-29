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
 * History round-trip tests
 *
 * Verifies the import-side handling of the `history` field AND the full
 * export → import contract:
 * - Importing a spec JSON without a `history` field initializes it to [].
 * - Importing a spec JSON with a `history` array preserves the entries.
 * - Exporting a spec strips `history`; importing the result yields history: [].
 *
 * In normal runtime-to-editor flow the runtime never includes `history` in the
 * package (it's excluded at export time), so the first case is the common path.
 * The second case covers forward-compat: if a future exporter re-includes
 * history for audit purposes, the importer must not destroy it.
 */

import { describe, it, expect } from 'vitest'
import type { Specification } from '@/types/library'
import type { SpecificationHistoryEntry } from '@/types/specification-history'
import { exportWorkflowSpec } from '@/lib/packageFormat/workflow-exporters'
import { importWorkflowSpecToInternal } from '../workflow-importers'
import type { MasterWorkflowSpecification } from '@/lib/packageFormat/export-types'

// =============================================================================
// Minimal spec factory
// =============================================================================

function makeMinimalSpec(
  overrides: Record<string, unknown> = {},
): MasterWorkflowSpecification & Record<string, unknown> {
  return {
    schemaVersion: '4.0',
    local_id: 'TestWorkflow',
    oid: 'spec-oid-1',
    version: '1.0.0',
    state: 'Draft',
    last_modified_date: new Date(1700000000000).toISOString(),
    steps: [],
    connections: [],
    ...overrides,
  }
}

// =============================================================================
// Round-trip tests
// =============================================================================

describe('importWorkflowSpecToInternal — history round-trip', () => {
  const now = Date.now()

  it('initializes history to [] when the incoming JSON has no history field', () => {
    const json = makeMinimalSpec() // no history property
    expect('history' in json).toBe(false)

    const result = importWorkflowSpecToInternal(json as MasterWorkflowSpecification, now)

    expect(result.history).toEqual([])
  })

  it('initializes history to [] when the incoming JSON has history: null', () => {
    const json = makeMinimalSpec({ history: null })
    const result = importWorkflowSpecToInternal(json as MasterWorkflowSpecification, now)
    expect(result.history).toEqual([])
  })

  it('initializes history to [] when the incoming JSON has history as a non-array', () => {
    const json = makeMinimalSpec({ history: 'oops' })
    const result = importWorkflowSpecToInternal(json as MasterWorkflowSpecification, now)
    expect(result.history).toEqual([])
  })

  it('preserves history entries when the incoming JSON carries them', () => {
    const entry: SpecificationHistoryEntry = {
      type: 'created',
      at: '2026-05-01T00:00:00Z',
      account: 'user@test.com',
      version: '1.0.0',
    }
    const json = makeMinimalSpec({ history: [entry] })
    const result = importWorkflowSpecToInternal(json as MasterWorkflowSpecification, now)
    expect(result.history).toEqual([entry])
  })

  it('preserves multiple history entries in order', () => {
    const entries: SpecificationHistoryEntry[] = [
      { type: 'created', at: '2026-05-01T00:00:00Z', account: 'a@b.com', version: '1.0.0' },
      {
        type: 'state_change',
        at: '2026-05-02T00:00:00Z',
        account: 'a@b.com',
        version: '1.0.0',
        fromState: 'Draft',
        toState: 'Approved',
        reason: 'some test reason',
      },
    ]
    const json = makeMinimalSpec({ history: entries })
    const result = importWorkflowSpecToInternal(json as MasterWorkflowSpecification, now)
    expect(result.history).toEqual(entries)
  })

  it('full round-trip: history is stripped at export, imported as []', () => {
    // Build a Specification with a non-empty history (same shape used in lib
    // history-exclusion tests).
    const spec: Specification = {
      id: 'spec-rt-1',
      libraryId: 'lib-rt-1',
      name: 'RoundTripSpec',
      description: null,
      version: '1.0.0',
      state: 'Draft',
      data: { nodes: [], edges: [] },
      history: [{ type: 'created', at: '2026-05-01T00:00:00Z', account: 'a@b.com', version: '1.0.0' }],
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    }

    // Export: exporter strips history via explicit-field allowlist
    const exported = exportWorkflowSpec(spec, [spec])

    // Import: history was not in the exported JSON, so it defaults to []
    const imported = importWorkflowSpecToInternal(exported, now)

    expect(imported.history).toEqual([])
  })
})
