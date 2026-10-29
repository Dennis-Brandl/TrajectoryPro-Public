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
import { exportEnvironmentPackage, type EnvironmentPackageActionLibrary } from '../library-exporters'

describe('exportEnvironmentPackage', () => {
  it('v2 grouped: produces actions/{Library}/{Action}.WFaction subdirs and manifest.actionLibraries[]', async () => {
    const env = {
      oid: 'env-1',
      local_id: 'Conveyor1',
      version: '1.0.0',
      last_modified_date: new Date().toISOString(),
      included_actions: [],
    } as any
    const grouped: EnvironmentPackageActionLibrary[] = [
      {
        libraryName: 'RobotControls',
        specs: [
          {
            oid: 'act-1',
            local_id: 'PickAndPlace',
            version: '1.0.0',
            last_modified_date: new Date().toISOString(),
          } as any,
          { oid: 'act-2', local_id: 'Move', version: '1.0.0', last_modified_date: new Date().toISOString() } as any,
        ],
      },
      {
        libraryName: 'Inspection',
        specs: [
          { oid: 'act-3', local_id: 'Inspect', version: '1.0.0', last_modified_date: new Date().toISOString() } as any,
        ],
      },
    ]
    const blob = await exportEnvironmentPackage(env, grouped)
    const zip = await JSZip.loadAsync(blob as unknown as Blob)
    const fileKeys = Object.keys(zip.files)
      .filter((k) => !zip.files[k].dir)
      .sort()
    expect(fileKeys).toEqual(
      [
        'Conveyor1.WFenvir',
        'actions/RobotControls/PickAndPlace.WFaction',
        'actions/RobotControls/Move.WFaction',
        'actions/Inspection/Inspect.WFaction',
        'manifest.json',
      ].sort(),
    )
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('text'))
    expect(manifest.packageType).toBe('environment-package')
    expect(manifest.formatVersion).toBe(2)
    expect(manifest.environmentName).toBe('Conveyor1')
    expect(manifest.actionCount).toBe(3)
    expect(manifest.actionLibraries).toEqual([
      { name: 'RobotControls', actions: ['PickAndPlace', 'Move'] },
      { name: 'Inspection', actions: ['Inspect'] },
    ])
  })

  it('legacy flat-array input: normalized into one synthetic library named after the env', async () => {
    const env = {
      oid: 'env-2',
      local_id: 'LegacyEnv',
      version: '1.0.0',
      last_modified_date: new Date().toISOString(),
      included_actions: [],
    } as any
    const includedActions = [
      { oid: 'act-1', local_id: 'PickAndPlace', version: '1.0.0', last_modified_date: new Date().toISOString() },
      { oid: 'act-2', local_id: 'Inspect', version: '1.0.0', last_modified_date: new Date().toISOString() },
    ] as any
    const blob = await exportEnvironmentPackage(env, includedActions)
    const zip = await JSZip.loadAsync(blob as unknown as Blob)
    const fileKeys = Object.keys(zip.files)
      .filter((k) => !zip.files[k].dir)
      .sort()
    expect(fileKeys).toEqual(
      [
        'LegacyEnv.WFenvir',
        'actions/LegacyEnv/PickAndPlace.WFaction',
        'actions/LegacyEnv/Inspect.WFaction',
        'manifest.json',
      ].sort(),
    )
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('text'))
    expect(manifest.actionLibraries).toEqual([{ name: 'LegacyEnv', actions: ['PickAndPlace', 'Inspect'] }])
  })

  it('handles empty action input — zip has {EnvName}.WFenvir and manifest.json only', async () => {
    const env = {
      oid: 'env-3',
      local_id: 'EmptyEnv',
      version: '1.0.0',
      last_modified_date: new Date().toISOString(),
      included_actions: [],
    } as any
    const blob = await exportEnvironmentPackage(env, [])
    const zip = await JSZip.loadAsync(blob as unknown as Blob)
    expect(Object.keys(zip.files).sort()).toEqual(['EmptyEnv.WFenvir', 'manifest.json'].sort())
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('text'))
    expect(manifest.actionCount).toBe(0)
    expect(manifest.actionLibraries).toEqual([])
  })
})
