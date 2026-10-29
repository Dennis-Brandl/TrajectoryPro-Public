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
import { createWorkflowLibraryPackage } from '@/lib/packageFormat/workflow-library-package'
import type { Library, Specification } from '@/types/library'
import type { LibraryWithChildren } from '@/lib/packageFormat/export-types'

function lib(over: Partial<Library>): Library {
  return {
    id: over.id ?? '100',
    name: over.name ?? 'Lib',
    entityType: over.entityType ?? 'workflow',
    description: null,
    version: over.version ?? '1.0.0',
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }
}

function spec(over: Partial<Specification>): Specification {
  return {
    id: over.id ?? '200',
    libraryId: over.libraryId ?? '100',
    name: over.name ?? 'Spec',
    description: null,
    version: over.version ?? '1.0.0',
    state: 'Draft',
    data: over.data ?? {},
    history: [],
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }
}

describe('createWorkflowLibraryPackage', () => {
  it('produces a ZIP with manifest packageVersion 1.1 and oidIndex listing every library and spec', async () => {
    const wfLib = lib({ id: '100', name: 'My WF Lib', entityType: 'workflow' })
    const wfSpec = spec({ id: '200', libraryId: '100', name: 'Wf A', data: { nodes: [], edges: [] } })
    const tree: LibraryWithChildren = { library: wfLib, specifications: [wfSpec], children: [] }
    const blob = await createWorkflowLibraryPackage({
      tree,
      images: {},
      allSpecs: [wfSpec],
      allLibraries: [wfLib],
      allSpecsByLibrary: new Map([['100', [wfSpec]]]),
    })
    // jszip's Blob output does not expose `.arrayBuffer()` in jsdom; loadAsync
    // accepts the blob directly.
    const zip = await JSZip.loadAsync(blob as unknown as Blob)
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'))
    expect(manifest.packageType).toBe('workflow-library')
    expect(manifest.packageVersion).toBe('1.1')
    expect(manifest.libraryName).toBe('My WF Lib')
    expect(manifest.oidIndex.libraries).toEqual([
      { oid: '100', name: 'My WF Lib', entityType: 'workflow', version: '1.0.0' },
    ])
    expect(manifest.oidIndex.specifications).toEqual([
      { oid: '200', libraryOid: '100', name: 'Wf A', version: '1.0.0' },
    ])
    expect(zip.file('My WF Lib.WFlib')).not.toBeNull()
  })

  it('inner workflow library JSON has TOP-LEVEL oid (schema-compliant, importable)', async () => {
    // Regression: createWorkflowLibraryPackage used to wrap the library as
    // { library: managedElement, workflow_specifications: [...] } which broke
    // server-side import (indexParsedJsons reads json.oid at top level).
    // The schema (master-workflow-library.json) declares the library JSON as
    // a ManagedElement itself, so oid MUST be at the top level.
    const wfLib = lib({ id: 'L-top', name: 'Top Lib', entityType: 'workflow' })
    const wfSpec = spec({ id: 'S-top', libraryId: 'L-top', name: 'Root Spec' })
    const tree: LibraryWithChildren = { library: wfLib, specifications: [wfSpec], children: [] }
    const blob = await createWorkflowLibraryPackage({
      tree,
      images: {},
      allSpecs: [wfSpec],
      allLibraries: [wfLib],
      allSpecsByLibrary: new Map([['L-top', [wfSpec]]]),
    })
    const zip = await JSZip.loadAsync(blob as unknown as Blob)
    const innerJson = JSON.parse(await zip.file('Top Lib.WFlib')!.async('string'))
    expect(innerJson.oid).toBe('L-top')
    expect(innerJson.local_id).toBe('Top Lib')
    expect(innerJson.workflow_specifications).toHaveLength(1)
    // Must NOT be the old broken shape:
    expect(innerJson.library).toBeUndefined()
  })

  it('child specs (version-chain via parentSpecificationId) are nested under root specs, not flat siblings', async () => {
    // Regression: the export used to put ALL specs flat in workflow_specifications,
    // causing two version-chain entries with the same name to land as sibling
    // roots and violate the specification_root_name_unique partial index on
    // re-import. The fix filters to roots and lets exportWorkflowSpec recurse.
    const wfLib = lib({ id: 'L-chain', name: 'Chain Lib', entityType: 'workflow' })
    const rootSpec = spec({
      id: 'root-1',
      libraryId: 'L-chain',
      name: 'Versioned Workflow',
      version: '1.0.0',
      data: { nodes: [], edges: [] },
    })
    const childVersion = spec({
      id: 'child-1',
      libraryId: 'L-chain',
      name: 'Versioned Workflow',
      version: '1.1.0',
      data: { nodes: [], edges: [], parentSpecificationId: 'root-1' },
    })
    const tree: LibraryWithChildren = {
      library: wfLib,
      specifications: [rootSpec, childVersion],
      children: [],
    }
    const blob = await createWorkflowLibraryPackage({
      tree,
      images: {},
      allSpecs: [rootSpec, childVersion],
      allLibraries: [wfLib],
      allSpecsByLibrary: new Map([['L-chain', [rootSpec, childVersion]]]),
    })
    const zip = await JSZip.loadAsync(blob as unknown as Blob)
    const innerJson = JSON.parse(await zip.file('Chain Lib.WFlib')!.async('string'))
    // Only the root is at the top level…
    expect(innerJson.workflow_specifications).toHaveLength(1)
    expect(innerJson.workflow_specifications[0].oid).toBe('root-1')
    // …and the child-version is nested under its `children` field.
    expect(innerJson.workflow_specifications[0].children?.length ?? 0).toBeGreaterThan(0)
    const childOids = (innerJson.workflow_specifications[0].children as Array<{ oid: string }>).map((c) => c.oid)
    expect(childOids).toContain('child-1')
  })

  it('includes referenced step library, environment library, and action library files', async () => {
    const actLib = lib({ id: '40', name: 'Cooking Actions', entityType: 'action' })
    const actSpec = spec({ id: '41', libraryId: '40', name: 'Saute' })
    const envLib = lib({ id: '20', name: 'Kitchen Env', entityType: 'environment' })
    const envSpec = spec({
      id: '21',
      libraryId: '20',
      name: 'Stovetop',
      data: { included_actions: [{ action_library: 'Cooking Actions' }] },
    })
    const stepLib = lib({ id: '30', name: 'Common Steps', entityType: 'step' })
    const stepSpec = spec({ id: '31', libraryId: '30', name: 'Heat' })
    const wfLib = lib({ id: '10', name: 'Recipes', entityType: 'workflow' })
    const wfSpec = spec({
      id: '11',
      libraryId: '10',
      name: 'Pasta',
      data: {
        environmentSpecIds: ['21'],
        nodes: [
          {
            id: 'n1',
            type: 'workflowProxy',
            data: { referencedStepLibraryId: '30', referencedStepSpecId: '31' },
          },
        ],
      },
    })

    const tree: LibraryWithChildren = { library: wfLib, specifications: [wfSpec], children: [] }
    const blob = await createWorkflowLibraryPackage({
      tree,
      images: {},
      allSpecs: [wfSpec, stepSpec, envSpec, actSpec],
      allLibraries: [wfLib, stepLib, envLib, actLib],
      allSpecsByLibrary: new Map([
        ['10', [wfSpec]],
        ['20', [envSpec]],
        ['30', [stepSpec]],
        ['40', [actSpec]],
      ]),
    })
    // jszip's Blob output does not expose `.arrayBuffer()` in jsdom; loadAsync
    // accepts the blob directly.
    const zip = await JSZip.loadAsync(blob as unknown as Blob)
    expect(zip.file('steps/Common Steps.WFslib')).not.toBeNull()
    expect(zip.file('environments/Kitchen Env.WFenvir')).not.toBeNull()
    expect(zip.file('actions/Cooking Actions.WFaction')).not.toBeNull()
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'))
    const libOids = manifest.oidIndex.libraries.map((l: { oid: string }) => l.oid).sort()
    expect(libOids).toEqual(['10', '20', '30', '40'])
    const specOids = manifest.oidIndex.specifications.map((s: { oid: string }) => s.oid).sort()
    expect(specOids).toEqual(['11', '21', '31', '41'])
  })

  it('picks up step library via referencedStepLibraryId alone (editor primary field)', async () => {
    // Regression: the earlier dependency walk gated on d.mode === 'reference'
    // && d.referencedSpecId, which the editor never writes. The real node
    // data carries `referencedStepLibraryId` directly. Exercise that field
    // ONLY (no referencedStepSpecId, no allSpecs membership) so the test
    // would fail again if the fallback ever becomes the only path.
    const stepLib = lib({ id: 'STEP-LIB', name: 'Step Lib', entityType: 'step' })
    const stepSpec = spec({ id: 'STEP-SPEC', libraryId: 'STEP-LIB', name: 'Sub Step' })
    const wfLib = lib({ id: 'WF-LIB', name: 'Wf Lib', entityType: 'workflow' })
    const wfSpec = spec({
      id: 'WF-SPEC',
      libraryId: 'WF-LIB',
      name: 'Wf With Proxy',
      data: {
        nodes: [
          {
            id: 'proxy-1',
            type: 'workflowProxy',
            data: { referencedStepLibraryId: 'STEP-LIB' },
          },
        ],
      },
    })
    const tree: LibraryWithChildren = { library: wfLib, specifications: [wfSpec], children: [] }
    const blob = await createWorkflowLibraryPackage({
      tree,
      images: {},
      allSpecs: [wfSpec, stepSpec],
      allLibraries: [wfLib, stepLib],
      allSpecsByLibrary: new Map([
        ['WF-LIB', [wfSpec]],
        ['STEP-LIB', [stepSpec]],
      ]),
    })
    const zip = await JSZip.loadAsync(blob as unknown as Blob)
    expect(zip.file('steps/Step Lib.WFslib')).not.toBeNull()
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'))
    const libOids = manifest.oidIndex.libraries.map((l: { oid: string }) => l.oid).sort()
    expect(libOids).toEqual(['STEP-LIB', 'WF-LIB'])
  })
})
