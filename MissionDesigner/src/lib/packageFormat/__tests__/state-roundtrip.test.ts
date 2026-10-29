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
import { exportWorkflowSpec, exportWorkflowLibrary } from '../workflow-exporters'
import { importWorkflowLibrary } from '../../import/library-importers'
import { exportEnvironmentLibrary } from '../library-exporters'
import { importEnvironmentLibrary } from '../../import/library-importers'
import type { Library, Specification, ChildSpecification } from '@/types/library'

const NOW = 0
const baseSpec = (over: Partial<Specification> = {}): Specification => ({
  id: 'wf-1',
  libraryId: 'lib-1',
  name: 'Root WF',
  description: null,
  version: '2.3.0',
  state: 'Approved',
  data: { nodes: [], edges: [] },
  history: [],
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
})

describe('workflow state round-trip', () => {
  it('emits the root spec state + version (not a hardcoded Draft)', () => {
    const out = exportWorkflowSpec(baseSpec(), [baseSpec()])
    expect(out.state).toBe('Approved')
    expect(out.version).toBe('2.3.0')
  })

  it('children inherit the root spec state + version', () => {
    const root = baseSpec()
    const childTree: ChildSpecification[] = [
      {
        id: 'child-1',
        parentSpecificationId: root.id,
        parentChildSpecId: null,
        name: 'Child WF',
        description: null,
        data: { nodes: [], edges: [] },
        depth: 1,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ]
    const out = exportWorkflowSpec(root, [root], undefined, undefined, childTree)
    expect(out.children).toBeDefined()
    expect(out.children![0].state).toBe('Approved')
    expect(out.children![0].version).toBe('2.3.0')
  })

  it('survives export → import (state read back, not forced to Draft)', () => {
    const library: Library = {
      id: 'lib-1',
      name: 'WF Lib',
      entityType: 'workflow',
      version: '1.0.0',
      createdAt: NOW,
      updatedAt: NOW,
    }
    const exported = exportWorkflowLibrary(library, [baseSpec()])
    const result = importWorkflowLibrary(exported)
    if ('error' in result) throw new Error(result.error)
    expect(result.specifications[0].state).toBe('Approved')
  })
})

describe('environment state round-trip', () => {
  it('survives export → import (env state read back, not forced to Draft)', () => {
    const envLib: Library = {
      id: 'env-lib-1',
      name: 'Env Lib',
      entityType: 'environment',
      version: '1.0.0',
      createdAt: NOW,
      updatedAt: NOW,
    }
    const envSpec: Specification = {
      id: 'env-1',
      libraryId: 'env-lib-1',
      name: 'Env A',
      description: null,
      version: '1.4.0',
      state: 'Effective',
      data: { included_actions: [] },
      history: [],
      createdAt: NOW,
      updatedAt: NOW,
    }
    const exported = exportEnvironmentLibrary(envLib, [envSpec])
    expect(exported.environment_specifications[0].state).toBe('Effective')
    const result = importEnvironmentLibrary(exported)
    if ('error' in result) throw new Error(result.error)
    expect(result.specifications[0].state).toBe('Effective')
  })
})
