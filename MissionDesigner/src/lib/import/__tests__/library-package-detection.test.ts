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
 * Tests for manifest-driven package-type detection and importLibraryPackage routing.
 *
 * Covers:
 * - detectPackageType: manifest-first, extension fallback, legacy .WFenvirX
 * - importLibraryPackage routing:
 *   - new .WFenvirX WITH manifest → environment-package (EnvironmentPackageResult)
 *   - legacy .WFenvirX WITHOUT manifest → environment-library (LibraryPackageResult)
 *   - new .WFenvirLibX WITH manifest → environment-library (LibraryPackageResult)
 */

import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { detectPackageType, importLibraryPackage } from '../library-package'

// =============================================================================
// Helpers
// =============================================================================

/** Build a File from a JSZip instance. */
async function zipToFile(zip: JSZip, filename: string): Promise<File> {
  const blob = await zip.generateAsync({ type: 'blob' })
  return new File([blob], filename, { type: 'application/zip' })
}

/**
 * Minimal MasterEnvironmentSpecification shape that passes
 * importEnvironmentLibrary validation when wrapped in a library envelope.
 */
function makeEnvSpec(name: string = 'TestEnv') {
  return {
    local_id: name,
    oid: `oid-env-${name}`,
    version: '1.0.0',
    included_actions: [],
    value_property_specifications: [],
    action_property_specifications: [],
  }
}

/**
 * Minimal MasterActionSpecification shape that passes importActionLibrary
 * validation when wrapped in a library envelope.
 */
function makeActionSpec(name: string = 'TestAction') {
  return {
    local_id: name,
    oid: `oid-action-${name}`,
    version: '1.0.0',
    input_parameter_specifications: [],
    output_parameter_specifications: [],
    property_specifications: [],
  }
}

/**
 * Minimal environment library JSON (for legacy / new library-shell packages).
 */
function makeEnvLibrary(name: string = 'TestEnvLib', specs: object[] = []) {
  return {
    local_id: name,
    oid: `oid-lib-${name}`,
    version: '1.0.0',
    environment_specifications: specs,
  }
}

// =============================================================================
// detectPackageType — manifest-first
// =============================================================================

describe('detectPackageType', () => {
  it('returns environment-package when manifest has packageType environment-package', async () => {
    const zip = new JSZip()
    zip.file('TestEnv.WFenvir', JSON.stringify(makeEnvSpec('TestEnv')))
    zip.file('manifest.json', JSON.stringify({ packageType: 'environment-package' }))

    const result = await detectPackageType(zip)
    expect(result).toBe('environment-package')
  })

  it('returns environment-library when manifest has packageType environment-library', async () => {
    const zip = new JSZip()
    zip.file('TestEnvLib.WFenvirLibX', JSON.stringify(makeEnvLibrary()))
    zip.file('manifest.json', JSON.stringify({ packageType: 'environment-library' }))

    const result = await detectPackageType(zip)
    expect(result).toBe('environment-library')
  })

  it('returns action-library when manifest has packageType action-library', async () => {
    const zip = new JSZip()
    zip.file('TestActionLib.WFactionLibX', '{}')
    zip.file('manifest.json', JSON.stringify({ packageType: 'action-library' }))

    const result = await detectPackageType(zip)
    expect(result).toBe('action-library')
  })

  it('falls back to extension detection when manifest is absent (legacy .WFenvirX → environment-library)', async () => {
    const zip = new JSZip()
    zip.file('Legacy.WFenvirX', JSON.stringify(makeEnvLibrary()))
    // No manifest.json

    const result = await detectPackageType(zip)
    expect(result).toBe('environment-library')
  })

  it('falls back to extension detection for .WFenvirLibX without manifest', async () => {
    const zip = new JSZip()
    zip.file('MyEnvLib.WFenvirLibX', JSON.stringify(makeEnvLibrary()))
    // No manifest.json

    const result = await detectPackageType(zip)
    expect(result).toBe('environment-library')
  })

  it('falls back to extension detection for .WFactionLibX without manifest', async () => {
    const zip = new JSZip()
    zip.file('MyActionLib.WFactionLibX', '{}')

    const result = await detectPackageType(zip)
    expect(result).toBe('action-library')
  })

  it('falls back to extension detection for .WFstepLibX without manifest', async () => {
    const zip = new JSZip()
    zip.file('MyStepLib.WFstepLibX', '{}')

    const result = await detectPackageType(zip)
    expect(result).toBe('step-library')
  })

  it('returns null when nothing matches', async () => {
    const zip = new JSZip()
    zip.file('unknown.json', '{}')

    const result = await detectPackageType(zip)
    expect(result).toBeNull()
  })

  it('falls back to extension when manifest has an unknown packageType', async () => {
    const zip = new JSZip()
    zip.file('Legacy.WFenvirX', JSON.stringify(makeEnvLibrary()))
    zip.file('manifest.json', JSON.stringify({ packageType: 'unsupported-future-type' }))

    // Falls through to extension detection
    const result = await detectPackageType(zip)
    expect(result).toBe('environment-library')
  })

  it('falls back to extension when manifest JSON is malformed', async () => {
    const zip = new JSZip()
    zip.file('Legacy.WFenvirX', JSON.stringify(makeEnvLibrary()))
    zip.file('manifest.json', 'NOT VALID JSON {{{')

    const result = await detectPackageType(zip)
    expect(result).toBe('environment-library')
  })
})

// =============================================================================
// importLibraryPackage — routing
// =============================================================================

describe('importLibraryPackage', () => {
  it('routes a v1 flat-actions environment-package; falls back to env-named library', async () => {
    // v1 packages have a flat actions/{name}.WFaction layout and no
    // included_actions mapping. The parser groups all unmapped specs under
    // a library named after the env.
    const envSpec = makeEnvSpec('ConveyorBelt')
    const actionSpec = makeActionSpec('MoveItem')

    const zip = new JSZip()
    zip.file('ConveyorBelt.WFenvir', JSON.stringify(envSpec))
    zip.file('actions/MoveItem.WFaction', JSON.stringify(actionSpec))
    zip.file(
      'manifest.json',
      JSON.stringify({
        packageType: 'environment-package',
        formatVersion: 1,
        environmentName: 'ConveyorBelt',
        actionCount: 1,
      }),
    )

    const file = await zipToFile(zip, 'ConveyorBelt.WFenvirX')
    const result = await importLibraryPackage(file)

    expect('error' in result).toBe(false)
    expect('packageType' in result).toBe(true)
    if (!('packageType' in result)) return

    expect(result.packageType).toBe('environment-package')
    expect(result.envName).toBe('ConveyorBelt')
    expect(result.envSpecJson).toMatchObject({ local_id: 'ConveyorBelt' })
    expect(result.actionLibraries).toHaveLength(1)
    expect(result.actionLibraries[0].libraryName).toBe('ConveyorBelt')
    expect(result.actionLibraries[0].actionSpecs).toHaveLength(1)
    expect(result.actionLibraries[0].actionSpecs[0].name).toBe('MoveItem')
    expect(result.actionLibraries[0].actionSpecs[0].json).toMatchObject({ local_id: 'MoveItem' })
  })

  it('routes a v1 flat-actions package using included_actions[].action_library to assign libraries', async () => {
    const envSpec = {
      ...makeEnvSpec('Cell'),
      included_actions: [
        { action_name: 'MoveItem', action_library: 'RobotControls' },
        { action_name: 'Inspect', action_library: 'Inspection' },
      ],
    }
    const zip = new JSZip()
    zip.file('Cell.WFenvir', JSON.stringify(envSpec))
    zip.file('actions/MoveItem.WFaction', JSON.stringify(makeActionSpec('MoveItem')))
    zip.file('actions/Inspect.WFaction', JSON.stringify(makeActionSpec('Inspect')))
    zip.file('manifest.json', JSON.stringify({ packageType: 'environment-package', formatVersion: 1 }))

    const result = await importLibraryPackage(await zipToFile(zip, 'Cell.WFenvirX'))
    if (!('packageType' in result)) throw new Error('expected EnvironmentPackageResult')

    const libNames = result.actionLibraries.map((l) => l.libraryName).sort()
    expect(libNames).toEqual(['Inspection', 'RobotControls'])
    const robot = result.actionLibraries.find((l) => l.libraryName === 'RobotControls')!
    expect(robot.actionSpecs.map((s) => s.name)).toEqual(['MoveItem'])
  })

  it('routes a v2 grouped-actions environment-package using subdir layout', async () => {
    const envSpec = makeEnvSpec('Cell')
    const zip = new JSZip()
    zip.file('Cell.WFenvir', JSON.stringify(envSpec))
    zip.file('actions/RobotControls/MoveItem.WFaction', JSON.stringify(makeActionSpec('MoveItem')))
    zip.file('actions/RobotControls/Pick.WFaction', JSON.stringify(makeActionSpec('Pick')))
    zip.file('actions/Inspection/Inspect.WFaction', JSON.stringify(makeActionSpec('Inspect')))
    zip.file(
      'manifest.json',
      JSON.stringify({
        packageType: 'environment-package',
        formatVersion: 2,
        actionLibraries: [
          { name: 'RobotControls', actions: ['MoveItem', 'Pick'] },
          { name: 'Inspection', actions: ['Inspect'] },
        ],
      }),
    )

    const result = await importLibraryPackage(await zipToFile(zip, 'Cell.WFenvirX'))
    if (!('packageType' in result)) throw new Error('expected EnvironmentPackageResult')

    const byName = new Map(result.actionLibraries.map((l) => [l.libraryName, l]))
    expect(
      byName
        .get('RobotControls')!
        .actionSpecs.map((s) => s.name)
        .sort(),
    ).toEqual(['MoveItem', 'Pick'])
    expect(byName.get('Inspection')!.actionSpecs.map((s) => s.name)).toEqual(['Inspect'])
  })

  it('routes a manifest-typed environment-package with no actions', async () => {
    const envSpec = makeEnvSpec('SimpleEnv')

    const zip = new JSZip()
    zip.file('SimpleEnv.WFenvir', JSON.stringify(envSpec))
    zip.file(
      'manifest.json',
      JSON.stringify({ packageType: 'environment-package', environmentName: 'SimpleEnv', actionCount: 0 }),
    )

    const file = await zipToFile(zip, 'SimpleEnv.WFenvirX')
    const result = await importLibraryPackage(file)

    expect('error' in result).toBe(false)
    expect('packageType' in result).toBe(true)
    if (!('packageType' in result)) return

    expect(result.packageType).toBe('environment-package')
    expect(result.envName).toBe('SimpleEnv')
    expect(result.actionLibraries).toHaveLength(0)
  })

  it('routes a legacy .WFenvirX (no manifest) to environment-library LibraryPackageResult', async () => {
    const envLib = makeEnvLibrary('LegacyEnvLib', [makeEnvSpec('EnvSpecA')])

    const zip = new JSZip()
    // No manifest.json — legacy format
    zip.file('LegacyEnvLib.WFenvirX', JSON.stringify(envLib))

    const file = await zipToFile(zip, 'LegacyEnvLib.WFenvirX')
    const result = await importLibraryPackage(file)

    expect('error' in result).toBe(false)
    // Should be a LibraryPackageResult (no packageType field)
    expect('packageType' in result).toBe(false)
    if ('error' in result || 'packageType' in result) return

    expect(result.entityType).toBe('environment')
    expect(result.libraryJson).toMatchObject({ local_id: 'LegacyEnvLib' })
  })

  it('routes a new .WFenvirLibX with manifest to environment-library LibraryPackageResult', async () => {
    const envLib = makeEnvLibrary('NewEnvLib', [makeEnvSpec('EnvSpecB')])

    const zip = new JSZip()
    zip.file('NewEnvLib.WFenvirLibX', JSON.stringify(envLib))
    zip.file('manifest.json', JSON.stringify({ packageType: 'environment-library', libraryName: 'NewEnvLib' }))

    const file = await zipToFile(zip, 'NewEnvLib.WFenvirLibX')
    const result = await importLibraryPackage(file)

    expect('error' in result).toBe(false)
    expect('packageType' in result).toBe(false)
    if ('error' in result || 'packageType' in result) return

    expect(result.entityType).toBe('environment')
    expect(result.libraryName).toBe('NewEnvLib')
    expect(result.libraryJson).toMatchObject({ local_id: 'NewEnvLib' })
  })

  it('routes a .WFactionLibX with manifest to action-library LibraryPackageResult', async () => {
    const actionLib = {
      local_id: 'MyActions',
      oid: 'oid-action-lib',
      version: '1.0.0',
      action_specifications: [makeActionSpec('DoThing')],
    }

    const zip = new JSZip()
    zip.file('MyActions.WFactionLibX', JSON.stringify(actionLib))
    zip.file('manifest.json', JSON.stringify({ packageType: 'action-library', libraryName: 'MyActions' }))

    const file = await zipToFile(zip, 'MyActions.WFactionLibX')
    const result = await importLibraryPackage(file)

    expect('error' in result).toBe(false)
    expect('packageType' in result).toBe(false)
    if ('error' in result || 'packageType' in result) return

    expect(result.entityType).toBe('action')
    expect(result.libraryName).toBe('MyActions')
  })

  it('returns an error for a ZIP with no recognised root file', async () => {
    const zip = new JSZip()
    zip.file('random.txt', 'nothing here')

    const file = await zipToFile(zip, 'unknown.zip')
    const result = await importLibraryPackage(file)

    expect('error' in result).toBe(true)
  })

  it('returns an error when the environment-package has no .WFenvir root file', async () => {
    const zip = new JSZip()
    zip.file('manifest.json', JSON.stringify({ packageType: 'environment-package' }))
    // Intentionally no .WFenvir root file

    const file = await zipToFile(zip, 'broken.WFenvirX')
    const result = await importLibraryPackage(file)

    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error).toMatch(/\.WFenvir/)
    }
  })
})
