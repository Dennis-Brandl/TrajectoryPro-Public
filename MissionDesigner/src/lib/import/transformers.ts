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

import type {
  ParameterSpecification,
  OutputParameterSpecification,
  PropertySpecification,
  ResourceCommandSpecification,
  ResourcePropertySpecification,
  ValueTypeSpecification,
} from '@/lib/packageFormat/export-types'
import type {
  ParameterSpec,
  ValueSpec,
  StepResourceCommand,
  ResourceSpec,
  UIParameterType,
  UIParameterSpec,
  ValueTypeSpec,
} from '@/types/nodes'
import { generateOID, WORKER_INTERNAL } from '@/lib/snowflake'

/**
 * Transforms input parameter specifications to internal format.
 */
export function transformInputParams(params: ParameterSpecification[] | undefined): ParameterSpec[] | undefined {
  if (!params || params.length === 0) return undefined

  return params.map((param) => ({
    id: param.oid || generateOID(WORKER_INTERNAL),
    name: param.id,
    entries: param.entries?.map((e) => ({
      id: generateOID(WORKER_INTERNAL),
      name: e.name,
      value: e.value,
    })),
    value: param.default_value,
    valueType: param.value_type === 'property' ? ('property' as const) : undefined,
    description: param.description,
    schema: param.json_schema,
  }))
}

/**
 * Transforms output parameter specifications to internal format.
 */
export function transformOutputParams(params: OutputParameterSpecification[] | undefined): ParameterSpec[] | undefined {
  if (!params || params.length === 0) return undefined

  return params.map((param) => ({
    id: param.oid || generateOID(WORKER_INTERNAL),
    name: param.id,
    entries: param.entries?.map((e) => ({
      id: generateOID(WORKER_INTERNAL),
      name: e.name,
      value: e.value,
    })),
    description: param.description,
    target: param.target,
  }))
}

/**
 * Transforms property specifications to internal value format.
 */
export function transformPropertySpecs(props: PropertySpecification[] | undefined): ValueSpec[] | undefined {
  if (!props || props.length === 0) return undefined

  return props.map((prop) => ({
    id: prop.oid || generateOID(WORKER_INTERNAL),
    name: prop.name,
    entries: (prop.entries || []).map((e) => ({
      id: generateOID(WORKER_INTERNAL),
      name: e.name,
      value: e.value,
    })),
  }))
}

/**
 * Transforms Value Type specifications (Designer library formats only) to
 * internal format. Wire `entries[].value` is the default-value template →
 * internal `defaultValue`.
 */
export function transformValueTypeSpecs(specs: ValueTypeSpecification[] | undefined): ValueTypeSpec[] | undefined {
  if (!specs || specs.length === 0) return undefined

  return specs.map((vt) => ({
    id: vt.oid || generateOID(WORKER_INTERNAL),
    name: vt.name,
    ...(vt.description ? { description: vt.description } : {}),
    entries: (vt.entries || []).map((e) => ({
      id: generateOID(WORKER_INTERNAL),
      name: e.name,
      ...(e.value ? { defaultValue: e.value } : {}),
    })),
  }))
}

/**
 * Transforms resource command specifications to internal format.
 */
export function transformResourceCommands(
  commands: ResourceCommandSpecification[] | undefined,
): StepResourceCommand[] | undefined {
  if (!commands || commands.length === 0) return undefined

  return commands.map((cmd) => ({
    id: cmd.oid || generateOID(WORKER_INTERNAL),
    resourceName: cmd.resource_name,
    resourceSourceType: cmd.resource_source_type,
    resourceSourceOid: cmd.resource_source_oid,
    // Pool commands collapse to the editor's basic Acquire/Release + count model
    // (the export side re-derives them from the resource's Count Limited type —
    // see resolveResourceSources). Release Pool Amount MUST land on Release: the
    // old blanket 'Acquire' fallback silently turned imported pool releases into
    // second acquires.
    commandType:
      cmd.command_type === 'Acquire' ||
      cmd.command_type === 'Release' ||
      cmd.command_type === 'Send' ||
      cmd.command_type === 'Receive' ||
      cmd.command_type === 'Synchronize'
        ? cmd.command_type
        : cmd.command_type === 'Release Pool Amount'
          ? 'Release'
          : 'Acquire',
    count: cmd.amount ?? 1,
    ...(cmd.target ? { target: cmd.target } : {}),
    ...(cmd.source ? { source: cmd.source } : {}),
  }))
}

/**
 * Transforms workflow-level resource property specifications to internal ResourceSpec format.
 */
export function transformResourcePropertySpecs(
  specs: ResourcePropertySpecification[] | undefined,
): ResourceSpec[] | undefined {
  if (!specs || specs.length === 0) return undefined

  return specs.map((res) => ({
    id: generateOID(WORKER_INTERNAL),
    name: res.name,
    description: res.description,
    resourceType:
      res.resource_type === 'binary exclusive use'
        ? ('Single Use' as const)
        : res.resource_type === 'countable use with pool limits'
          ? ('Count Limited' as const)
          : res.resource_type === 'named pool'
            ? ('Named' as const)
            : res.resource_type === 'sync'
              ? ('Sync' as const)
              : ('Shared Use' as const),
    count: res.resource_type === 'named pool' ? (res.names?.length ?? 0) : (res.use_limit ?? 1),
    ...(res.names && res.names.length > 0 ? { names: res.names } : {}),
  }))
}

/**
 * Transforms UI parameter specifications to internal format.
 * Regenerates IDs since they were stripped on export.
 */
export function transformUIParams(
  params:
    | Array<{
        oid?: string
        type: string
        value: string
        font_size?: number
        color?: string
        lines?: number
        align?: string
        value2?: string
      }>
    | undefined,
): UIParameterSpec[] | undefined {
  if (!params || params.length === 0) return undefined

  return params.map(
    (param) =>
      ({
        id: param.oid || generateOID(WORKER_INTERNAL),
        type: param.type as UIParameterType,
        value: param.value,
        ...(param.font_size != null ? { fontSize: param.font_size } : {}),
        ...(param.color ? { color: param.color } : {}),
        ...(param.lines != null ? { lines: param.lines } : {}),
        ...(param.align ? { align: param.align as 'left' | 'center' | 'right' } : {}),
        ...(param.value2 ? { value2: param.value2 } : {}),
      }) as UIParameterSpec,
  )
}

/**
 * Ensures YES_NO steps have a YesNoButtons block in their uiParameters.
 * For legacy imports that only have yes_no_config labels, creates the block.
 */
export function ensureYesNoButtonsBlock(
  uiParams: UIParameterSpec[] | undefined,
  yesLabel: string | undefined,
  noLabel: string | undefined,
): UIParameterSpec[] | undefined {
  if (uiParams?.some((p) => p.type === 'YesNoButtons')) return uiParams

  const block: UIParameterSpec = {
    id: generateOID(WORKER_INTERNAL),
    type: 'YesNoButtons',
    value: yesLabel || 'Yes',
    value2: noLabel || 'No',
  }

  return uiParams ? [...uiParams, block] : [block]
}

/**
 * Upsert the preserved v1 FORM Yes/No labels into uiParameters. The v1 runtime rendered
 * the form's footer buttons, so their labels are the operator-visible truth and win over
 * whatever the YesNoButtons block currently carries; empty labels never clobber.
 */
export function applyYesNoLabels(
  uiParams: UIParameterSpec[] | undefined,
  labels: { yes: string; no: string },
): UIParameterSpec[] | undefined {
  const yes = labels.yes.trim()
  const no = labels.no.trim()
  if (!yes && !no) return uiParams
  const existing = uiParams?.find((p) => p.type === 'YesNoButtons')
  if (!existing) return ensureYesNoButtonsBlock(uiParams, yes || undefined, no || undefined)
  return uiParams!.map((p) => (p.type === 'YesNoButtons' ? { ...p, value: yes || p.value, value2: no || p.value2 } : p))
}
