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
import { exportWorkflowSpec } from '../workflow-exporters'
import { exportEnvironmentLibrary } from '../library-exporters'
import { exportWorkflowLibrary } from '../workflow-exporters'
import type { Library, Specification, ChildSpecification } from '@/types/library'

const NOW = 0
const lib: Library = { id: 'lib-9', name: 'My WF Lib', entityType: 'workflow', createdAt: NOW, updatedAt: NOW }
const wf: Specification = {
  id: 'wf-9',
  libraryId: 'lib-9',
  name: 'WF',
  description: null,
  version: '1.0.0',
  state: 'Draft',
  data: { nodes: [], edges: [] },
  history: [],
  createdAt: NOW,
  updatedAt: NOW,
}

describe('per-spec containing-library ref', () => {
  it('workflow spec records its library name + oid', () => {
    const out = exportWorkflowSpec(wf, [wf], [lib])
    expect(out.library_name).toBe('My WF Lib')
    expect(out.library_oid).toBe('lib-9')
  })

  it('child workflows inherit the root library ref', () => {
    const childTree: ChildSpecification[] = [
      {
        id: 'c-9',
        parentSpecificationId: 'wf-9',
        parentChildSpecId: null,
        name: 'Child',
        description: null,
        data: { nodes: [], edges: [] },
        depth: 1,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ]
    const out = exportWorkflowSpec(wf, [wf], [lib], undefined, childTree)
    expect(out.children![0].library_name).toBe('My WF Lib')
    expect(out.children![0].library_oid).toBe('lib-9')
  })

  it('env spec records its library name + oid in the env-library path', () => {
    const envLib: Library = { id: 'el-9', name: 'Env Lib 9', entityType: 'environment', createdAt: NOW, updatedAt: NOW }
    const envSpec: Specification = {
      id: 'e-9',
      libraryId: 'el-9',
      name: 'E',
      description: null,
      version: '1.0.0',
      state: 'Draft',
      data: { included_actions: [] },
      history: [],
      createdAt: NOW,
      updatedAt: NOW,
    }
    const out = exportEnvironmentLibrary(envLib, [envSpec])
    expect(out.environment_specifications[0].library_name).toBe('Env Lib 9')
    expect(out.environment_specifications[0].library_oid).toBe('el-9')
  })
})

describe('library-level parent_library_oid', () => {
  it('emits parent_library_oid from Library.parentLibraryId', () => {
    const childLib: Library = {
      id: 'lib-child',
      parentLibraryId: 'lib-parent',
      name: 'Child Lib',
      entityType: 'workflow',
      createdAt: NOW,
      updatedAt: NOW,
    }
    const out = exportWorkflowLibrary(childLib, [])
    expect(out.parent_library_oid).toBe('lib-parent')
  })

  it('omits parent_library_oid for a root library', () => {
    const out = exportWorkflowLibrary(lib, [])
    expect(out.parent_library_oid).toBeUndefined()
  })
})
