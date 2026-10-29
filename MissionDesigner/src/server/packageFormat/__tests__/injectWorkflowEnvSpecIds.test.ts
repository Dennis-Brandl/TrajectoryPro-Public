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
import { injectWorkflowEnvSpecIds } from '../injectWorkflowEnvSpecIds'
import type { ImportPlan } from '../parseEnvelope'

function makeSpec(sourceId: string, data: object): ImportPlan['specs'][number] {
  return {
    sourceId,
    parentSourceId: null,
    rootSourceId: sourceId,
    name: sourceId,
    description: null,
    version: '1.0.0',
    state: 'Draft',
    dataJson: JSON.stringify(data),
    dataSchemaVersion: 3,
  }
}

function emptyPlan(specs: ImportPlan['specs']): ImportPlan {
  return { specs, imageRefs: [], proxyRefs: [], specEnvs: [], pendingEnvLibraryLinks: [] }
}

const ENV_SPEC_BAKERY: { name: string; data: { _libraryName: string } } = {
  name: 'Bakery',
  data: { _libraryName: 'Shared Env' },
}

describe('injectWorkflowEnvSpecIds', () => {
  it('resolves a single _pendingEnvironmentSpecs entry to a new envSpecId', () => {
    const spec = makeSpec('w-1', { _pendingEnvironmentSpecs: [ENV_SPEC_BAKERY] })
    const lookup = new Map([['Shared Env', new Map([['Bakery', 'new-spec-1']])]])

    injectWorkflowEnvSpecIds(emptyPlan([spec]), lookup)

    const data = JSON.parse(spec.dataJson) as { environmentSpecIds?: string[]; _pendingEnvironmentSpecs?: unknown }
    expect(data.environmentSpecIds).toEqual(['new-spec-1'])
    expect(data._pendingEnvironmentSpecs).toBeUndefined()
  })

  it('preserves existing environmentSpecIds and merges new ones (insertion-order, deduped)', () => {
    const spec = makeSpec('w-1', {
      environmentSpecIds: ['keep-1'],
      _pendingEnvironmentSpecs: [ENV_SPEC_BAKERY],
    })
    const lookup = new Map([['Shared Env', new Map([['Bakery', 'new-spec-1']])]])

    injectWorkflowEnvSpecIds(emptyPlan([spec]), lookup)

    const data = JSON.parse(spec.dataJson) as { environmentSpecIds: string[] }
    expect(data.environmentSpecIds).toEqual(['keep-1', 'new-spec-1'])
  })

  it('dedupes when an existing id is also resolved from the pending sidecar', () => {
    const spec = makeSpec('w-1', {
      environmentSpecIds: ['new-spec-1'],
      _pendingEnvironmentSpecs: [ENV_SPEC_BAKERY],
    })
    const lookup = new Map([['Shared Env', new Map([['Bakery', 'new-spec-1']])]])

    injectWorkflowEnvSpecIds(emptyPlan([spec]), lookup)

    const data = JSON.parse(spec.dataJson) as { environmentSpecIds: string[] }
    expect(data.environmentSpecIds).toEqual(['new-spec-1'])
  })

  it('skips entries whose library is missing from the lookup', () => {
    const spec = makeSpec('w-1', {
      _pendingEnvironmentSpecs: [ENV_SPEC_BAKERY, { name: 'Orphan', data: { _libraryName: 'Missing Lib' } }],
    })
    const lookup = new Map([['Shared Env', new Map([['Bakery', 'new-spec-1']])]])

    injectWorkflowEnvSpecIds(emptyPlan([spec]), lookup)

    const data = JSON.parse(spec.dataJson) as { environmentSpecIds: string[] }
    expect(data.environmentSpecIds).toEqual(['new-spec-1'])
  })

  it('strips the pending sidecar even when nothing resolves', () => {
    const spec = makeSpec('w-1', {
      _pendingEnvironmentSpecs: [{ name: 'Orphan', data: { _libraryName: 'Missing Lib' } }],
    })

    injectWorkflowEnvSpecIds(emptyPlan([spec]), new Map())

    const data = JSON.parse(spec.dataJson) as { _pendingEnvironmentSpecs?: unknown; environmentSpecIds?: unknown }
    expect(data._pendingEnvironmentSpecs).toBeUndefined()
    expect(data.environmentSpecIds).toBeUndefined()
  })

  it('accepts the legacy top-level libraryName shape on pending entries', () => {
    const spec = makeSpec('w-1', {
      _pendingEnvironmentSpecs: [{ name: 'Bakery', libraryName: 'Shared Env' }],
    })
    const lookup = new Map([['Shared Env', new Map([['Bakery', 'new-spec-1']])]])

    injectWorkflowEnvSpecIds(emptyPlan([spec]), lookup)

    const data = JSON.parse(spec.dataJson) as { environmentSpecIds: string[] }
    expect(data.environmentSpecIds).toEqual(['new-spec-1'])
  })

  it('is a no-op when the spec has no _pendingEnvironmentSpecs', () => {
    const spec = makeSpec('w-1', { foo: 'bar' })

    injectWorkflowEnvSpecIds(emptyPlan([spec]), new Map())

    expect(JSON.parse(spec.dataJson)).toEqual({ foo: 'bar' })
  })

  it('isolates resolution per spec across a multi-spec plan', () => {
    const a = makeSpec('a', { _pendingEnvironmentSpecs: [ENV_SPEC_BAKERY] })
    const b = makeSpec('b', {
      _pendingEnvironmentSpecs: [{ name: 'Cafe', data: { _libraryName: 'Shared Env' } }],
    })
    const lookup = new Map([
      [
        'Shared Env',
        new Map([
          ['Bakery', 'spec-a-id'],
          ['Cafe', 'spec-b-id'],
        ]),
      ],
    ])

    injectWorkflowEnvSpecIds(emptyPlan([a, b]), lookup)

    const dataA = JSON.parse(a.dataJson) as { environmentSpecIds: string[] }
    const dataB = JSON.parse(b.dataJson) as { environmentSpecIds: string[] }
    expect(dataA.environmentSpecIds).toEqual(['spec-a-id'])
    expect(dataB.environmentSpecIds).toEqual(['spec-b-id'])
  })
})
