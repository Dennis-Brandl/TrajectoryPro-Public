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

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import JSZip from 'jszip'
import { buildScenario, expandSimDiceRoll } from '../build'
import type { ScenarioDefinition } from '../types'

async function makeScenarioRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'scenario-build-'))
  await mkdir(path.join(root, 'code', 'ActionA'), { recursive: true })
  await mkdir(path.join(root, 'code', 'ActionB'), { recursive: true })
  await writeFile(path.join(root, 'code', 'ActionA', 'STARTING.py'), 'starting_a')
  await writeFile(path.join(root, 'code', 'ActionA', 'EXECUTING.py'), 'executing_a')
  await writeFile(path.join(root, 'code', 'ActionB', 'IN_PROGRESS.py'), 'in_progress_b')
  return root
}

function makeScenario(rootDir: string): ScenarioDefinition {
  return {
    rootDir,
    library: { oid: 'lib-test-1', local_id: 'TestLib', version: '1.0.0' },
    environment: {
      oid: 'env-test-1',
      local_id: 'TestEnv',
      version: '1.0.0',
      schemaVersion: '4.0',
      action_property_specifications: [
        { name: 'SIMULATION_MODE', entries: [{ name: 'Value', value: 'false' }] },
      ],
    },
    actions: [
      {
        oid: 'act-a',
        local_id: 'ActionA',
        version: '1.0.0',
        visibility: 'observable',
        inputs: [],
        outputs: [{ id: 'status', value_type: 'literal', default_value: '0' }],
        code_states: ['STARTING', 'EXECUTING'],
      },
      {
        oid: 'act-b',
        local_id: 'ActionB',
        version: '1.0.0',
        visibility: 'opaque',
        inputs: [],
        outputs: [{ id: 'status', value_type: 'literal', default_value: '0' }],
        code_states: ['IN_PROGRESS'],
      },
    ],
  }
}

describe('buildScenario', () => {
  let outDir: string

  beforeEach(async () => {
    outDir = await mkdtemp(path.join(tmpdir(), 'scenario-out-'))
  })

  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true })
  })

  it('writes a .WFenvir at <outDir>/<library.local_id>.WFenvir', async () => {
    const root = await makeScenarioRoot()
    const scenario = makeScenario(root)
    const result = await buildScenario(scenario, outDir)

    expect(result.envFilePath).toBe(path.join(outDir, 'TestLib.WFenvir'))
    const content = JSON.parse(await readFile(result.envFilePath, 'utf-8'))
    expect(content.oid).toBe('lib-test-1')
    expect(content.local_id).toBe('TestLib')
    expect(content.version).toBe('1.0.0')
    expect(content.last_modified_date).toBeDefined()
    expect(content.environment_specifications).toHaveLength(1)
    expect(content.environment_specifications[0].oid).toBe('env-test-1')
    expect(content.environment_specifications[0].included_actions).toHaveLength(2)
    expect(content.environment_specifications[0].included_actions[0].oid).toBe('act-a')
    expect(content.environment_specifications[0].included_actions[0].action_visibility).toBe(
      'observable'
    )
    expect(
      content.environment_specifications[0].included_actions[0].last_modified_date
    ).toBeDefined()

    await rm(root, { recursive: true })
  })

  it('copies python source from <rootDir>/code/<action>/<state>.py to <outDir>/code/...', async () => {
    const root = await makeScenarioRoot()
    const scenario = makeScenario(root)
    const result = await buildScenario(scenario, outDir)

    expect(result.codeFiles).toHaveLength(3) // 2 for ActionA + 1 for ActionB
    const startingA = path.join(outDir, 'code', 'ActionA', 'STARTING.py')
    expect(await readFile(startingA, 'utf-8')).toBe('starting_a')

    await rm(root, { recursive: true })
  })

  it('produces a .WFactionCodeX ZIP per action under actions/', async () => {
    const root = await makeScenarioRoot()
    const scenario = makeScenario(root)
    const result = await buildScenario(scenario, outDir)

    expect(result.actionPackages).toHaveLength(2)
    const actionAPackage = result.actionPackages.find((p) => p.actionLocalId === 'ActionA')
    expect(actionAPackage?.path).toBe(path.join(outDir, 'actions', 'ActionA.WFactionCodeX'))

    const buf = await readFile(actionAPackage!.path)
    const zip = await JSZip.loadAsync(buf)

    const actionWFaction = zip.file('action.WFaction')
    expect(actionWFaction).not.toBeNull()
    const actionJson = JSON.parse(await actionWFaction!.async('text'))
    expect(actionJson.oid).toBe('act-a')
    expect(actionJson.environment_oid).toBe('env-test-1')
    expect(actionJson.action_visibility).toBe('observable')

    const startingPy = zip.file('code/STARTING.py')
    expect(startingPy).not.toBeNull()
    expect(await startingPy!.async('text')).toBe('starting_a')

    const executingPy = zip.file('code/EXECUTING.py')
    expect(executingPy).not.toBeNull()

    await rm(root, { recursive: true })
  })

  it('expands sim_dice_roll markers in copied .py files and ZIP entries', async () => {
    const root = await makeScenarioRoot()
    // Overwrite ActionA STARTING with an observable-marker version, ActionB IN_PROGRESS with opaque.
    await writeFile(
      path.join(root, 'code', 'ActionA', 'STARTING.py'),
      'def execute(inputs, outputs, props, action_props):\n    # {{sim_dice_roll: observable}}\n'
    )
    await writeFile(
      path.join(root, 'code', 'ActionB', 'IN_PROGRESS.py'),
      "def execute(inputs, outputs, props, action_props):\n    # {{sim_dice_roll: opaque, msg='widget offline'}}\n"
    )
    const scenario = makeScenario(root)
    const result = await buildScenario(scenario, outDir)

    const startingA = await readFile(path.join(outDir, 'code', 'ActionA', 'STARTING.py'), 'utf-8')
    expect(startingA).toContain("props.get('SIMULATION_MODE'")
    expect(startingA).not.toContain('{{sim_dice_roll')
    expect(startingA).not.toMatch(/raise RuntimeError/)

    const actionBZip = await JSZip.loadAsync(
      await readFile(result.actionPackages.find((p) => p.actionLocalId === 'ActionB')!.path)
    )
    const inProgressB = await actionBZip.file('code/IN_PROGRESS.py')!.async('text')
    expect(inProgressB).toContain('ActionB: simulated random {mode} (widget offline)')
    expect(inProgressB).toContain('raise RuntimeError(')
    expect(inProgressB).not.toContain('{{sim_dice_roll')

    await rm(root, { recursive: true })
  })

  it('throws when a declared code_state has no .py file', async () => {
    const root = await makeScenarioRoot()
    const scenario = makeScenario(root)
    // ActionA declares STARTING + EXECUTING; add a third state that has no file.
    scenario.actions[0]!.code_states.push('COMPLETING')

    await expect(buildScenario(scenario, outDir)).rejects.toThrow(/COMPLETING\.py/)

    await rm(root, { recursive: true })
  })
})

describe('expandSimDiceRoll', () => {
  it('expands observable markers without a raise clause', () => {
    const src = [
      'def execute(inputs, outputs, props, action_props):',
      '    # {{sim_dice_roll: observable}}',
      '',
    ].join('\n')
    const out = expandSimDiceRoll(src, 'PickItem')
    expect(out).toContain(
      "props.get('SIMULATION_MODE', {}).get('Value', 'false').lower() == 'true'"
    )
    expect(out).toContain("outputs['status'] = '1' if mode == 'abort' else '2'")
    expect(out).not.toContain('raise RuntimeError')
    expect(out).not.toContain('{{sim_dice_roll')
  })

  it('expands opaque markers WITH a raise clause and interpolates action local_id + msg', () => {
    const src = [
      'def execute(inputs, outputs, props, action_props):',
      "    # {{sim_dice_roll: opaque, msg='printer offline'}}",
      '',
    ].join('\n')
    const out = expandSimDiceRoll(src, 'PrintLabel')
    expect(out).toContain('raise RuntimeError(')
    expect(out).toContain('PrintLabel: simulated random {mode} (printer offline)')
    expect(out).not.toContain('{{sim_dice_roll')
  })

  it('preserves indentation (8-space marker yields 8-space-indented expansion)', () => {
    const src = '        # {{sim_dice_roll: observable}}\n'
    const out = expandSimDiceRoll(src, 'NestedAction')
    for (const line of out.split('\n').filter((l) => l.trim().length > 0)) {
      expect(line.startsWith('        ')).toBe(true)
    }
  })

  it('throws when opaque marker is missing the msg kwarg', () => {
    const src = '    # {{sim_dice_roll: opaque}}\n'
    expect(() => expandSimDiceRoll(src, 'BadAction')).toThrow(/requires msg=/)
  })

  it('returns source unchanged when no marker is present', () => {
    const src = 'def execute(i, o, p, a):\n    pass\n'
    expect(expandSimDiceRoll(src, 'NoOp')).toBe(src)
  })

  it('preserves a blank line immediately after the marker', () => {
    const src = [
      'def execute(inputs, outputs, props, action_props):',
      "    # {{sim_dice_roll: opaque, msg='widget down'}}",
      '',
      '    # Clean path follows',
      '    pass',
      '',
    ].join('\n')
    const out = expandSimDiceRoll(src, 'BlankPreserve')
    // The blank line and the "Clean path follows" comment must both still be there.
    expect(out).toMatch(/\)\n\n {4}# Clean path follows/)
  })

  it('handles multiple markers in the same source', () => {
    const src = [
      'def execute(inputs, outputs, props, action_props):',
      '    # {{sim_dice_roll: observable}}',
      '    print("between")',
      "    # {{sim_dice_roll: opaque, msg='second roll'}}",
      '',
    ].join('\n')
    const out = expandSimDiceRoll(src, 'TwoRolls')
    // Observable expansion appears (no raise on that variant)
    expect(out.match(/outputs\['status'\] = '1' if mode == 'abort' else '2'/g)).toHaveLength(2)
    expect(out).toContain('raise RuntimeError(')
    expect(out).toContain('TwoRolls: simulated random {mode} (second roll)')
    expect(out).not.toContain('{{sim_dice_roll')
  })
})
