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

// A .WFlibX exported on one machine must recreate the environments and actions on
// another, or the imported workflow cannot be validated. This runs the real exporter
// into the real preview + commit routes against an empty database.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import JSZip from 'jszip'
import { createWorkflowLibraryPackage } from '@/lib/packageFormat/workflow-library-package'
import { exportEnvironmentSpec } from '@/lib/packageFormat/library-exporters'
import type { Library, Specification } from '@/types/library'
import { setupTestFixture, resetAndSeedFixture, mockSessionAs, rawQuery, type TestFixture } from './testSeed'

let f: TestFixture

beforeAll(async () => {
  f = await setupTestFixture()
})

beforeEach(async () => {
  await resetAndSeedFixture(f)
  mockSessionAs(f.userIdGlobal)
})

const lib = (id: string, name: string, entityType: Library['entityType']): Library =>
  ({
    id,
    name,
    entityType,
    parentLibraryId: null,
    description: null,
    author: null,
    changeHistory: null,
    version: '1.0.0',
    createdAt: 1,
    updatedAt: 1,
  }) as Library

const spec = (id: string, libraryId: string, name: string, data: Record<string, unknown>): Specification =>
  ({
    id,
    libraryId,
    name,
    description: null,
    version: '1.0.0',
    state: 'Draft',
    data,
    history: [],
    createdAt: 1,
    updatedAt: 1,
  }) as Specification

const ENV_DATA = {
  included_actions: [{ action_name: 'Bake', action_library: 'Kitchen Actions' }],
  values: [{ id: 'val-1', name: 'OvenTemp', entries: [{ name: 'Value', value: '450' }] }],
  actionProperties: [{ id: 'prop-1', name: 'Mode', entries: [{ name: 'Value', value: 'normal' }] }],
  valueTypes: [{ id: 'vt-1', name: 'Order', entries: [{ name: 'Size', defaultValue: 'Large' }] }],
  resources: [
    { id: 'r1', name: 'Mixer', resourceType: 'Single Use', count: 1, description: 'one at a time' },
    { id: 'r2', name: 'Oven', resourceType: 'Shared Use', count: 4 },
    { id: 'r3', name: 'Trays', resourceType: 'Count Limited', count: 8 },
    { id: 'r4', name: 'Stations', resourceType: 'Named', count: 2, names: ['A', 'B'] },
    { id: 'r5', name: 'Handoff', resourceType: 'Sync', count: 1 },
  ],
  actionServers: [
    { id: 's1', name: 'Kitchen Server', uri: 'http://kitchen:3002', description: 'main', connectionType: 'REST' },
  ],
}

const ACTION_DATA = {
  inputs: [{ id: 'in-1', name: 'Temp', value: '400' }],
  outputs: [{ id: 'out-1', name: 'Done', target: 'Done' }],
  values: [{ id: 'av-1', name: 'Retries', entries: [{ name: 'Value', value: '3' }] }],
  actionVisibility: 'observable',
}

async function exportedPackage(): Promise<Uint8Array> {
  const workflowLib = lib('wf-lib', 'Recipes', 'workflow')
  const envLib = lib('env-lib', 'Kitchen', 'environment')
  const actionLib = lib('act-lib', 'Kitchen Actions', 'action')
  const workflow = spec('wf-1', 'wf-lib', 'Bake Pizza', { nodes: [], edges: [], environmentSpecIds: ['env-1'] })
  const env = spec('env-1', 'env-lib', 'Kitchen Env', ENV_DATA)
  const action = spec('act-1', 'act-lib', 'Bake', ACTION_DATA)
  const blob = await createWorkflowLibraryPackage({
    tree: { library: workflowLib, specifications: [workflow], children: [] },
    images: {},
    allSpecs: [workflow, env, action],
    allLibraries: [workflowLib, envLib, actionLib],
    allSpecsByLibrary: new Map([
      ['wf-lib', [workflow]],
      ['env-lib', [env]],
      ['act-lib', [action]],
    ]),
  })
  return new Uint8Array(await blob.arrayBuffer())
}

/** The exported package with one environment made invalid, as a damaged or hand-edited file would be. */
async function packageWithInvalidEnvironment(): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(await exportedPackage())
  const path = 'environments/Kitchen.WFenvir'
  const json = JSON.parse(await zip.files[path].async('string'))
  delete json.environment_specifications[0].included_actions
  zip.file(path, JSON.stringify(json))
  return zip.generateAsync({ type: 'uint8array' })
}

async function importPackage(bytes: Uint8Array, resolutions: Record<string, 'keep' | 'replace'> = {}) {
  const form = new FormData()
  form.append('file', new File([bytes.buffer as ArrayBuffer], 'bundle.WFlibX', { type: 'application/zip' }))
  const preview = await f.app.request('/api/v2/packages/workflow-library/preview', {
    method: 'POST',
    headers: { origin: 'http://localhost:5173' },
    body: form,
  })
  expect(preview.status).toBe(200)
  const { previewId } = (await preview.json()) as { previewId: string }
  const commit = await f.app.request('/api/v2/packages/workflow-library/commit', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
    body: JSON.stringify({ previewId, resolutions, teamId: f.teamMainId }),
  })
  expect(commit.status).toBe(200)
  return (await commit.json()) as { warnings: string[] }
}

async function storedData(id: string): Promise<Record<string, unknown> | null> {
  const rows = await rawQuery<{ data: string }>('SELECT data FROM "specification" WHERE id = $1', [id])
  return rows[0] ? (JSON.parse(rows[0].data) as Record<string, unknown>) : null
}

const names = (list: unknown) => (list as Array<{ name: string }>).map((x) => x.name)

describe('.WFlibX import recreates environments and actions', () => {
  it('keeps every part of the environment', async () => {
    const report = await importPackage(await exportedPackage())
    expect(report.warnings).toEqual([])

    const env = (await storedData('env-1'))!
    expect(env.included_actions).toEqual([{ action_name: 'Bake', action_library: 'Kitchen Actions' }])
    expect(names(env.values)).toEqual(['OvenTemp'])
    expect(names(env.actionProperties)).toEqual(['Mode'])
    expect(names(env.valueTypes)).toEqual(['Order'])
    expect(
      (env.resources as Array<{ name: string; resourceType: string; count: number }>).map((r) => [
        r.name,
        r.resourceType,
        r.count,
      ]),
    ).toEqual([
      ['Mixer', 'Single Use', 1],
      ['Oven', 'Shared Use', 4],
      ['Trays', 'Count Limited', 8],
      ['Stations', 'Named', 2],
      ['Handoff', 'Sync', 1],
    ])
    expect(env.actionServers).toEqual([
      expect.objectContaining({
        name: 'Kitchen Server',
        uri: 'http://kitchen:3002',
        description: 'main',
        connectionType: 'REST',
      }),
    ])
  })

  it('keeps the action specification the environment includes', async () => {
    await importPackage(await exportedPackage())
    const action = (await storedData('act-1'))!
    expect(names(action.inputs)).toEqual(['Temp'])
    expect(names(action.outputs)).toEqual(['Done'])
    expect(names(action.values)).toEqual(['Retries'])
    expect(action.actionVisibility).toBe('observable')
  })

  it('links the workflow to the imported environment', async () => {
    await importPackage(await exportedPackage())
    expect((await storedData('wf-1'))!.environmentSpecIds).toEqual(['env-1'])
  })

  it('exports the imported environment the same as the original', async () => {
    await importPackage(await exportedPackage())
    const shape = (data: Record<string, unknown>) => {
      const out = exportEnvironmentSpec(
        spec('env-1', 'env-lib', 'Kitchen Env', data),
        'Kitchen',
        undefined,
        undefined,
        undefined,
        { includeValueTypes: true },
      )
      const { last_modified_date: _ignored, ...rest } = out as unknown as Record<string, unknown>
      return rest
    }
    expect(shape((await storedData('env-1'))!)).toEqual(shape(ENV_DATA))
  })

  it('reports a spec the package cannot rebuild instead of storing it empty', async () => {
    const report = await importPackage(await packageWithInvalidEnvironment())

    expect(await storedData('env-1')).toBeNull()
    expect(report.warnings).toEqual([expect.stringContaining('Kitchen Env')])
  })

  it('leaves the existing spec alone when its replacement cannot be rebuilt', async () => {
    await importPackage(await exportedPackage())
    // Same library and name under a different id, so the import sees a conflict rather than a no-op.
    await rawQuery(
      `INSERT INTO "specification"
         (id, "libraryId", name, version, state, data, "dataSchemaVersion", "rootSpecificationId", history, "createdAt", "updatedAt")
       SELECT 'env-local', "libraryId", name, '0.9.0', state, data, "dataSchemaVersion", 'env-local', history, "createdAt", "updatedAt"
       FROM "specification" WHERE id = 'env-1'`,
    )
    await rawQuery(`DELETE FROM "specification" WHERE id = 'env-1'`)

    const report = await importPackage(await packageWithInvalidEnvironment(), { 'env-1': 'replace' })

    expect((await storedData('env-local'))?.included_actions).toHaveLength(1)
    expect(report.warnings).toEqual([expect.stringContaining('Kitchen Env')])
  })
})
