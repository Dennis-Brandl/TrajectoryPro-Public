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

// @vitest-environment node

import { describe, it, expect } from 'vitest'
import { parseWorkflowEnvelope, EnvelopeParseError } from '../parseEnvelope'

describe('parseWorkflowEnvelope — input validation', () => {
  it('rejects when JSON is not parseable', () => {
    expect(() => parseWorkflowEnvelope('not json')).toThrow(/json_envelope_invalid/)
  })

  it('rejects when schemaVersion is missing', () => {
    expect(() => parseWorkflowEnvelope('{}')).toThrow(/json_envelope_invalid/)
  })

  it('rejects schemaVersion 2.0 with unsupported_schema_version', () => {
    const json = JSON.stringify({ schemaVersion: '2.0', specifications: [] })
    expect(() => parseWorkflowEnvelope(json)).toThrow(EnvelopeParseError)
    expect(() => parseWorkflowEnvelope(json)).toThrow(/unsupported_schema_version/)
  })

  it('rejects the legacy v3.0 flat envelope (no longer supported)', () => {
    const json = JSON.stringify({
      schemaVersion: '3.0',
      library: { id: 'lib1', name: 'Old Lib' },
      specifications: [
        {
          id: 'r1',
          name: 'Root',
          version: '1.0.0',
          state: 'Draft',
          data: { nodes: [] },
          dataSchemaVersion: 3,
          parentSpecificationId: null,
          rootSpecificationId: 'r1',
          children: [],
        },
      ],
    })
    expect(() => parseWorkflowEnvelope(json)).toThrow(/unsupported_schema_version/)
  })
})

describe('parseWorkflowEnvelope — v7.0', () => {
  function buildV7Root(overrides?: Record<string, unknown>): Record<string, unknown> {
    return {
      schemaVersion: '4.0',
      local_id: 'V7 Root',
      oid: 'oid-root-1',
      version: '1.0.0',
      state: 'Draft',
      last_modified_date: new Date().toISOString(),
      steps: [
        {
          local_id: 'Start',
          oid: 'oid-step-start',
          step_type: 'START',
          version: '1.0.0',
          last_modified_date: new Date().toISOString(),
          position: { x: 100, y: 100 },
        },
        {
          local_id: 'End',
          oid: 'oid-step-end',
          step_type: 'END',
          version: '1.0.0',
          last_modified_date: new Date().toISOString(),
          position: { x: 100, y: 250 },
        },
      ],
      connections: [{ from_step_id: 'oid-step-start', to_step_id: 'oid-step-end' }],
      ...overrides,
    }
  }

  it('parses a minimal v7 envelope', () => {
    const plan = parseWorkflowEnvelope(JSON.stringify(buildV7Root()))
    expect(plan.specs).toHaveLength(1)
    expect(plan.specs[0].sourceId).toBe('oid-root-1')
    expect(plan.specs[0].name).toBe('V7 Root')
    expect(plan.specs[0].parentSourceId).toBeNull()
    expect(plan.specs[0].rootSourceId).toBe('oid-root-1')
  })

  it('rejects an envelope with missing schemaVersion (no silent v7 fallback)', () => {
    const env = buildV7Root() as Record<string, unknown>
    delete env.schemaVersion
    // The dispatch validates schemaVersion presence before any shape detection,
    // so a missing version is a hard error even if v7 fields are present. This
    // is intentional — the contract requires explicit schemaVersion.
    expect(() => parseWorkflowEnvelope(JSON.stringify(env))).toThrow(/json_envelope_invalid/)
  })

  it('flattens a 3-level children tree with parentChildSpecId linkage', () => {
    const root = buildV7Root({
      children: [
        {
          local_id: 'Child A',
          oid: 'oid-child-A',
          parentChildSpecId: null,
          schemaVersion: '4.0',
          version: '1.0.0',
          state: 'Draft',
          last_modified_date: new Date().toISOString(),
          steps: [],
          connections: [],
          children: [
            {
              local_id: 'Grandchild',
              oid: 'oid-grandchild',
              parentChildSpecId: 'oid-child-A',
              schemaVersion: '4.0',
              version: '1.0.0',
              state: 'Draft',
              last_modified_date: new Date().toISOString(),
              steps: [],
              connections: [],
            },
          ],
        },
      ],
    })
    const plan = parseWorkflowEnvelope(JSON.stringify(root))
    expect(plan.specs).toHaveLength(3)

    const root1 = plan.specs.find((s) => s.sourceId === 'oid-root-1')!
    const childA = plan.specs.find((s) => s.sourceId === 'oid-child-A')!
    const grand = plan.specs.find((s) => s.sourceId === 'oid-grandchild')!

    expect(root1.parentSourceId).toBeNull()
    // ChildWorkflowExport with parentChildSpecId === null = direct child of root.
    expect(childA.parentSourceId).toBe('oid-root-1')
    // Grandchild parentChildSpecId points at the parent ChildWorkflowExport's oid.
    expect(grand.parentSourceId).toBe('oid-child-A')
    expect(grand.rootSourceId).toBe('oid-root-1')
  })

  it('extracts proxy refs from converted v7 data on workflowProxy steps', () => {
    const root = buildV7Root({
      steps: [
        {
          local_id: 'Start',
          oid: 'oid-s1',
          step_type: 'START',
          version: '1.0.0',
          last_modified_date: new Date().toISOString(),
          position: { x: 100, y: 100 },
        },
        {
          local_id: 'Sub',
          oid: 'oid-s2',
          step_type: 'WORKFLOW PROXY',
          version: '1.0.0',
          last_modified_date: new Date().toISOString(),
          position: { x: 100, y: 250 },
        },
        {
          local_id: 'End',
          oid: 'oid-s3',
          step_type: 'END',
          version: '1.0.0',
          last_modified_date: new Date().toISOString(),
          position: { x: 100, y: 400 },
        },
      ],
    })
    const plan = parseWorkflowEnvelope(JSON.stringify(root))
    // No proxy refs because the v7 envelope above doesn't carry an
    // embeddedWorkflowSpecId on the proxy step. The runtime resolves children
    // via the children[] tree, not via inline ids — so an absence is correct.
    expect(plan.proxyRefs).toEqual([])
    expect(plan.specs).toHaveLength(1)
  })

  it('silently drops legacy child_workflows on import; children is preserved', () => {
    // Case 1: both children and child_workflows present — children wins, child_workflows dropped.
    const rootBoth = buildV7Root({
      children: [
        {
          local_id: 'Child A',
          oid: 'oid-child-1',
          schemaVersion: '4.0',
          version: '1.0.0',
          state: 'Draft',
          last_modified_date: new Date().toISOString(),
          steps: [],
          connections: [],
        },
      ],
      child_workflows: [
        {
          local_id: 'Legacy Child',
          oid: 'oid-legacy-1',
          schemaVersion: '4.0',
          version: '1.0.0',
          state: 'Draft',
          last_modified_date: new Date().toISOString(),
          steps: [],
          connections: [],
        },
      ],
    })
    const planBoth = parseWorkflowEnvelope(JSON.stringify(rootBoth))
    // Root + children[] child only; child_workflows entry dropped.
    expect(planBoth.specs).toHaveLength(2)
    expect(planBoth.specs.find((s) => s.sourceId === 'oid-child-1')).toBeDefined()
    expect(planBoth.specs.find((s) => s.sourceId === 'oid-legacy-1')).toBeUndefined()

    // Case 2: only child_workflows present (no children) — child_workflows is NOT a fallback; result is root only.
    const rootLegacyOnly = buildV7Root({
      children: undefined,
      child_workflows: [
        {
          local_id: 'Legacy Child',
          oid: 'oid-legacy-2',
          schemaVersion: '4.0',
          version: '1.0.0',
          state: 'Draft',
          last_modified_date: new Date().toISOString(),
          steps: [],
          connections: [],
        },
      ],
    })
    const planLegacyOnly = parseWorkflowEnvelope(JSON.stringify(rootLegacyOnly))
    // child_workflows is silently dropped — only the root spec remains.
    expect(planLegacyOnly.specs).toHaveLength(1)
    expect(planLegacyOnly.specs[0].sourceId).toBe('oid-root-1')
    expect(planLegacyOnly.specs.find((s) => s.sourceId === 'oid-legacy-2')).toBeUndefined()
  })

  it('surfaces a step-level invalid form_document as EnvelopeParseError invalid_form_document, not an uncaught exception', () => {
    // transformWorkflowSpec (shared with the client importWorkflow() path — see
    // form-layout-import.test.ts's "P4.1 form_document import" describe) throws on an
    // invalid form_document. This pins that the server envelope parser catches it and
    // re-surfaces it as its own EnvelopeParseError shape instead of an uncaught throw.
    const root = buildV7Root({
      steps: [
        {
          local_id: 'Form Step',
          oid: 'oid-step-form',
          step_type: 'USER_INTERACTION',
          version: '1.0.0',
          last_modified_date: new Date().toISOString(),
          form_document: { version: 2, sections: [{ id: 'c', role: 'bogus', rows: [] }] },
        },
      ],
      connections: [],
    })
    expect(() => parseWorkflowEnvelope(JSON.stringify(root))).toThrow(EnvelopeParseError)
    expect(() => parseWorkflowEnvelope(JSON.stringify(root))).toThrow(/invalid_form_document/)
  })
})

describe('parseWorkflowEnvelope — type_name', () => {
  const now = new Date().toISOString()
  function env(extra: Record<string, unknown>, children?: unknown[]): string {
    return JSON.stringify({
      schemaVersion: '4.0',
      local_id: 'R',
      oid: 'oid-r',
      version: '1.0.0',
      state: 'Draft',
      last_modified_date: now,
      steps: [],
      connections: [],
      ...extra,
      ...(children ? { children } : {}),
    })
  }
  const kid = (extra: Record<string, unknown>) => ({
    local_id: 'K',
    oid: 'oid-k',
    parentChildSpecId: null,
    schemaVersion: '4.0',
    version: '1.0.0',
    state: 'Draft',
    last_modified_date: now,
    steps: [],
    connections: [],
    ...extra,
  })

  it('reads type_name on the root and on a child', () => {
    const plan = parseWorkflowEnvelope(env({ type_name: 'Procedure' }, [kid({ type_name: 'Unit Procedure' })]))
    expect(plan.specs.find((s) => s.sourceId === 'oid-r')!.typeName).toBe('Procedure')
    expect(plan.specs.find((s) => s.sourceId === 'oid-k')!.typeName).toBe('Unit Procedure')
  })

  it('absent or non-string type_name yields null', () => {
    const plan = parseWorkflowEnvelope(env({}, [kid({ type_name: 3 })]))
    expect(plan.specs.find((s) => s.sourceId === 'oid-r')!.typeName).toBeNull()
    expect(plan.specs.find((s) => s.sourceId === 'oid-k')!.typeName).toBeNull()
    expect(parseWorkflowEnvelope(env({ type_name: 3 })).specs[0].typeName).toBeNull()
  })
})
