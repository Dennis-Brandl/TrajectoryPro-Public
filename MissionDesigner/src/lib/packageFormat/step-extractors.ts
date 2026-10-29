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

import type { FormDocument } from '@mission/form-schema'
import { joinDuration, type DurationParts } from '@/lib/duration'
import type { ResourceCommandSpecification, MasterWorkflowStep } from './export-types'

// =============================================================================
// Step-Specific Configuration Extractors
// =============================================================================

/**
 * Extracts resource command specifications from spec data.
 */
export function extractResourceCommands(data: Record<string, unknown>): ResourceCommandSpecification[] | undefined {
  const commands = data.resourceCommands as
    | Array<{
        id: string
        resourceName: string
        resourceSourceType?: string
        resourceSourceOid?: string
        commandType: string
        count?: number
        target?: string
        source?: string
      }>
    | undefined
  if (!commands || commands.length === 0) return undefined

  return commands.map((cmd) => ({
    oid: cmd.id,
    command_type: cmd.commandType as ResourceCommandSpecification['command_type'],
    resource_name: cmd.resourceName,
    resource_source_type: (cmd.resourceSourceType ?? 'workflow') as 'workflow' | 'environment',
    resource_source_oid: cmd.resourceSourceOid ?? '',
    amount: cmd.count,
    ...(cmd.target ? { target: cmd.target } : {}),
    ...(cmd.source ? { source: cmd.source } : {}),
  }))
}

/**
 * Extracts UI parameter specifications from step data (for UI step types).
 */
export function extractUIParameters(data: Record<string, unknown>):
  | Array<{
      oid: string
      type: string
      value: string
      font_size?: number
      color?: string
      lines?: number
      align?: string
      value2?: string
    }>
  | undefined {
  const uiParams = data.uiParameters as
    | Array<{
        id: string
        type: string
        value: string
        fontSize?: number
        color?: string
        lines?: number
        align?: string
        value2?: string
      }>
    | undefined

  if (!uiParams || uiParams.length === 0) return undefined

  return uiParams.map((param) => ({
    oid: param.id,
    type: param.type,
    value: param.value,
    ...(param.fontSize != null ? { font_size: param.fontSize } : {}),
    ...(param.color ? { color: param.color } : {}),
    ...(param.lines != null && param.lines > 1 ? { lines: param.lines } : {}),
    ...(param.align && param.align !== 'left' ? { align: param.align } : {}),
    ...(param.value2 ? { value2: param.value2 } : {}),
  }))
}

/**
 * Extracts Yes/No step configuration.
 */
export function extractYesNoConfig(data: Record<string, unknown>):
  | {
      yes_label?: string
      no_label?: string
      yes_value?: string
      no_value?: string
      default_selection?: 'yes' | 'no' | 'none'
    }
  | undefined {
  // Read labels from YesNoButtons block in uiParameters
  const uiParams = data.uiParameters as Array<{ type: string; value: string; value2?: string }> | undefined
  const yesNoBlock = uiParams?.find((p) => p.type === 'YesNoButtons')

  const hasConfig =
    yesNoBlock !== undefined ||
    data.yesNoYesValue !== undefined ||
    data.yesNoNoValue !== undefined ||
    data.yesNoDefaultSelection !== undefined

  if (!hasConfig) return undefined

  return {
    yes_label: yesNoBlock?.value,
    no_label: yesNoBlock?.value2,
    yes_value: 'true',
    no_value: 'false',
    default_selection: data.yesNoDefaultSelection as 'yes' | 'no' | 'none' | undefined,
  }
}

/**
 * Extracts Script step configuration. `repeat` (spec 2026-10-13 §6.1) only when Repeat until done
 * is on, so a one-shot script exports exactly as before; the time limit and its outcome only
 * when the boxes total at least one second (blank boxes = no time limit).
 */
export function extractScriptConfig(data: Record<string, unknown>): MasterWorkflowStep['script_config'] | undefined {
  const language = data.scriptLanguage as string | undefined
  const source = data.scriptSource as string | undefined
  const repeat = data.scriptRepeat === true ? extractScriptRepeat(data) : undefined

  if (!language && !source && !repeat) return undefined

  return {
    language,
    source,
    ...(repeat ? { repeat } : {}),
  }
}

function extractScriptRepeat(
  data: Record<string, unknown>,
): NonNullable<MasterWorkflowStep['script_config']>['repeat'] {
  const limit = joinDuration(data.scriptTimeLimit as DurationParts | undefined)
  return {
    cycle_seconds: (data.scriptCycleSeconds as number | undefined) ?? 5,
    ...(limit > 0
      ? {
          time_limit_seconds: limit,
          on_time_limit: data.scriptOnTimeLimit === 'complete' ? ('complete' as const) : ('error' as const),
        }
      : {}),
  }
}

/**
 * Extracts Gate step configuration (spec 2026-08-29 §8.4). The script rides the same
 * node fields the Script step uses (scriptSource/scriptLanguage) so ScriptEditorModal
 * binds unchanged; bindings are NOT stored on the node — applyActionPropertyBindings derives them
 * at export time on the assembled spec.
 */
export function extractGateConfig(data: Record<string, unknown>): MasterWorkflowStep['gate_config'] | undefined {
  const cycle = data.gateCycleSeconds as number | undefined
  const language = data.scriptLanguage as string | undefined
  const source = data.scriptSource as string | undefined
  // Emitted ONLY when exactly true — never false — so absence semantics are preserved and
  // ordinary gates (flag unset) stay byte-identical on the wire (spec 2026-08-30 amendment).
  const controlPreviousAction = data.gateControlPreviousAction === true
  // Spec 2026-10-13 §4.2: mode + delay only for the timed modes; a condition gate keeps its
  // stored delay on the node (for switching back) but never exports it.
  const mode = data.gateMode
  const timed = mode === 'timer' || mode === 'condition_or_timer'
  if (cycle === undefined && !language && !source && !controlPreviousAction && !timed) return undefined
  return {
    ...(cycle !== undefined ? { cycle_seconds: cycle } : {}),
    ...(language ? { language } : {}),
    ...(source ? { source } : {}),
    ...(controlPreviousAction ? { control_previous_action: true } : {}),
    ...(timed ? { mode, delay_seconds: joinDuration(data.gateDelay as DurationParts | undefined) } : {}),
  }
}

/**
 * Extracts the v2 Form Document for export — the canonical FormDocument, VERBATIM.
 * Ids are exported (the v1 id-strip / index-pairing / SYNCED_PROPERTIES dance is gone);
 * content is the sanitized HTML string (no RichTextContent wrapper — spec amendment §7.5).
 * An undesigned step (absent document or no blocks anywhere) exports NOTHING: the v1
 * default-button backfill is retired — completion is UI-host chrome in v2 (design §3.2/§9.1).
 */
export function extractFormDocument(data: Record<string, unknown>): FormDocument | undefined {
  const doc = data.formDocument as FormDocument | undefined
  if (!doc) return undefined
  const hasBlocks = doc.sections.some((s) => s.rows.some((r) => r.blocks.length > 0))
  return hasBlocks ? doc : undefined
}

/**
 * Extracts stable image OID → filename mappings from v2 image blocks.
 * These references survive runtime workflow creation where step OIDs change.
 */
export function extractFormElementImages(
  data: Record<string, unknown>,
): MasterWorkflowStep['form_element_images'] | undefined {
  const doc = data.formDocument as FormDocument | undefined
  if (!doc) return undefined

  const seen = new Set<string>()
  const images: Array<{ image_oid: string; filename: string }> = []

  for (const section of doc.sections) {
    for (const row of section.rows) {
      for (const block of row.blocks) {
        if (block.type !== 'image') continue
        const { src, imageOid } = block
        if (!imageOid || !src) continue
        if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:')) continue
        if (src === 'No image selected') continue // palette default placeholder — no bytes to bundle
        if (seen.has(imageOid)) continue
        seen.add(imageOid)
        images.push({ image_oid: imageOid, filename: src })
      }
    }
  }

  return images.length > 0 ? images : undefined
}

// =============================================================================
// TRY/CATCH/RETURN Extractors
// =============================================================================

const VALID_TRY_MODES = new Set(['ERROR', 'ABORT', 'TIMEOUT'])

/**
 * Extracts try_specifications from a node's data (verbatim inner shape — no field renaming).
 */
export function extractTrySpecifications(data: Record<string, unknown>) {
  const ts = data?.trySpecifications
  if (!Array.isArray(ts) || ts.length === 0) return undefined
  const cleaned = ts.filter(
    (t) =>
      t &&
      VALID_TRY_MODES.has((t as { mode?: string }).mode ?? '') &&
      typeof (t as { catch_id?: unknown }).catch_id === 'string',
  )
  return cleaned.length ? cleaned : undefined
}

/**
 * Extracts return_config from a node's data (verbatim inner shape — no field renaming).
 *
 * ABANDON is the editor's default command (ReturnConfigEditor displays it when none is set).
 * A RETURN left untouched never persists returnConfig to node data, so without this default it
 * would export with no return_config and the runtime could not dispatch it. Only ever called for
 * return nodes (all callers guard on nodeType === 'return').
 */
export function extractReturnConfig(data: Record<string, unknown>): MasterWorkflowStep['return_config'] | undefined {
  const rc = data?.returnConfig as MasterWorkflowStep['return_config'] | undefined
  if (!rc?.command) return { command: 'ABANDON' }
  return rc
}

/**
 * Extracts catch_id from a node's data (camelCase → snake_case outer rename only).
 */
export function extractCatchId(data: Record<string, unknown>): string | undefined {
  return typeof data?.catchId === 'string' ? (data.catchId as string) : undefined
}

/**
 * Extracts Select 1 step configuration.
 */
export function extractSelect1Config(data: Record<string, unknown>): MasterWorkflowStep['select1_config'] | undefined {
  const inputName = data.select1InputName as string | undefined
  const inputValueType = data.select1InputValueType as 'literal' | 'property' | undefined
  const options = data.select1Options as
    | Array<{
        id: string
        label: string
        operator: string
        value: string
        valueType: 'literal' | 'property'
        isDefault: boolean
      }>
    | undefined

  if (!inputName && !inputValueType && !options) return undefined

  return {
    input_name: inputName,
    input_value_type: inputValueType,
    options: options?.map((o) => ({
      id: o.id,
      label: o.label,
      operator: o.operator,
      value: o.value,
      value_type: o.valueType,
      is_default: o.isDefault,
    })),
  }
}
