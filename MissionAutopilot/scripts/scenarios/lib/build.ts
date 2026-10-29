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

import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import path from 'node:path'
import JSZip from 'jszip'
import type {
  ActionDefinition,
  BuildResult,
  EnvironmentDefinition,
  ScenarioDefinition,
} from './types.js'

const FIXED_TIMESTAMP = '2026-05-09T00:00:00Z'

const SIM_DICE_ROLL_MARKER =
  /^([ \t]*)# \{\{sim_dice_roll:\s*(observable|opaque)(?:,\s*(.*?))?\}\}[ \t]*$/gm

/**
 * Expand `# {{sim_dice_roll: variant[, kwargs]}}` markers in scenario .py source.
 *
 * Variants:
 *   - `observable` — sets `outputs['status']` to '1' or '2' on a 10% dice roll;
 *     does NOT raise (subsequent state — typically EXECUTING — reads status and reacts).
 *   - `opaque, msg='<failure context>'` — sets status AND raises immediately, since
 *     opaque actions have no STARTING flush window for a downstream state to react.
 *
 * The action's `local_id` is interpolated into the opaque raise message so each
 * action gets a `<ActionName>: simulated random {mode} (<msg>)` exception string.
 *
 * Indentation: the marker's leading whitespace (spaces or tabs) is replicated
 * on every line of the expansion so the block lands at the right indent level.
 */
export function expandSimDiceRoll(source: string, actionLocalId: string): string {
  SIM_DICE_ROLL_MARKER.lastIndex = 0
  return source.replace(
    SIM_DICE_ROLL_MARKER,
    (_match, indent: string, variant: string, kwargs: string | undefined) => {
      const head = [
        `${indent}sim = (`,
        `${indent}    props.get('SIMULATION_MODE', {}).get('Value', 'false').lower() == 'true'`,
        `${indent})`,
        `${indent}if sim and random.random() < 0.10:`,
        `${indent}    mode = random.choice(['abort', 'timeout'])`,
        `${indent}    outputs['status'] = '1' if mode == 'abort' else '2'`,
      ]
      if (variant === 'observable') {
        return head.join('\n')
      }
      const msgMatch = kwargs?.match(/msg\s*=\s*'([^']*)'/)
      if (!msgMatch) {
        throw new Error(
          `sim_dice_roll opaque marker in ${actionLocalId} requires msg='<failure context>'; got: ${kwargs ?? '(none)'}`
        )
      }
      const msg = msgMatch[1]
      return [
        ...head,
        `${indent}    raise RuntimeError(`,
        `${indent}        f'${actionLocalId}: simulated random {mode} (${msg})'`,
        `${indent}    )`,
      ].join('\n')
    }
  )
}

function actionDeclaration(
  action: ActionDefinition,
  environmentOid: string
): Record<string, unknown> {
  return {
    oid: action.oid,
    local_id: action.local_id,
    version: action.version,
    last_modified_date: FIXED_TIMESTAMP,
    environment_oid: environmentOid,
    action_visibility: action.visibility,
    description: action.description ?? null,
    input_parameter_specifications: action.inputs,
    output_parameter_specifications: action.outputs,
    property_specifications: action.property_specifications ?? [],
  }
}

function envDeclaration(
  env: EnvironmentDefinition,
  actions: ActionDefinition[]
): Record<string, unknown> {
  return {
    oid: env.oid,
    local_id: env.local_id,
    version: env.version,
    last_modified_date: FIXED_TIMESTAMP,
    description: env.description ?? null,
    action_property_specifications: env.action_property_specifications ?? [],
    value_property_specifications: env.value_property_specifications ?? [],
    resource_property_specifications: env.resource_property_specifications ?? [],
    included_actions: actions.map((a) => actionDeclaration(a, env.oid)),
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

export async function buildScenario(
  scenario: ScenarioDefinition,
  outDir: string
): Promise<BuildResult> {
  // 1. Verify all declared code files exist; collect contents.
  const codeContents: Array<{
    action: ActionDefinition
    state: string
    sourcePath: string
    source: string
  }> = []
  for (const action of scenario.actions) {
    for (const state of action.code_states) {
      const sourcePath = path.join(scenario.rootDir, 'code', action.local_id, `${state}.py`)
      if (!(await fileExists(sourcePath))) {
        throw new Error(`Missing code file for ${action.local_id}/${state}: expected ${sourcePath}`)
      }
      const rawSource = await readFile(sourcePath, 'utf-8')
      const source = expandSimDiceRoll(rawSource, action.local_id)
      codeContents.push({ action, state, sourcePath, source })
    }
  }

  await mkdir(outDir, { recursive: true })
  await mkdir(path.join(outDir, 'code'), { recursive: true })
  await mkdir(path.join(outDir, 'actions'), { recursive: true })

  // 2. Write the library-level .WFenvir
  const envFilePath = path.join(outDir, `${scenario.library.local_id}.WFenvir`)
  const envJson = {
    oid: scenario.library.oid,
    local_id: scenario.library.local_id,
    version: scenario.library.version,
    last_modified_date: FIXED_TIMESTAMP,
    schemaVersion: scenario.environment.schemaVersion ?? '4.0',
    environment_specifications: [envDeclaration(scenario.environment, scenario.actions)],
  }
  await writeFile(envFilePath, JSON.stringify(envJson, null, 2), 'utf-8')

  // 3. Write each .py file (post-marker-expansion) to <outDir>/code/<action>/<state>.py
  const codeFiles: BuildResult['codeFiles'] = []
  for (const { action, state, source } of codeContents) {
    const destPath = path.join(outDir, 'code', action.local_id, `${state}.py`)
    await mkdir(path.dirname(destPath), { recursive: true })
    await writeFile(destPath, source, 'utf-8')
    codeFiles.push({
      actionOid: action.oid,
      actionLocalId: action.local_id,
      state,
      path: destPath,
    })
  }

  // 4. Build per-action .WFactionCodeX ZIPs
  const actionPackages: BuildResult['actionPackages'] = []
  for (const action of scenario.actions) {
    const zip = new JSZip()
    zip.file(
      'action.WFaction',
      JSON.stringify(actionDeclaration(action, scenario.environment.oid), null, 2)
    )
    for (const { state, source } of codeContents.filter((c) => c.action.oid === action.oid)) {
      zip.file(`code/${state}.py`, source)
    }
    const buf = await zip.generateAsync({ type: 'nodebuffer' })
    const zipPath = path.join(outDir, 'actions', `${action.local_id}.WFactionCodeX`)
    await writeFile(zipPath, buf)
    actionPackages.push({
      actionOid: action.oid,
      actionLocalId: action.local_id,
      path: zipPath,
    })
  }

  return {
    envFilePath,
    codeFiles,
    actionPackages,
    actions: scenario.actions,
    scenario,
  }
}
