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
  ResourcePropertySpecification,
  ValueTypeSpecification,
} from './export-types'
import type { ParameterSpec } from '@/types/nodes'
import { withCanonicalCatchOutputs } from '@/lib/catch-outputs'

// =============================================================================
// Parameter Extractors
// =============================================================================

/**
 * Extracts input parameter specifications from spec data.
 */
export function extractInputParams(data: Record<string, unknown>): ParameterSpecification[] | undefined {
  const inputs = data.inputs as
    | Array<{
        id: string
        name: string
        value?: string
        valueType?: 'literal' | 'property'
        description?: string
        schema?: string
        entries?: Array<{ name: string; value: string }>
      }>
    | undefined
  if (!inputs || inputs.length === 0) return undefined

  return inputs.map((input) => ({
    id: input.name,
    oid: input.id,
    description: input.description ?? input.entries?.find((e) => e.name === 'Description')?.value,
    default_value: input.value ?? input.entries?.find((e) => e.name === 'Value')?.value ?? '',
    value_type: input.valueType === 'property' ? 'property' : undefined,
    json_schema: input.schema,
    entries: input.entries?.map((e) => ({ name: e.name, value: e.value })),
  }))
}

/**
 * Output extraction for workflow steps: CATCH steps always export the four
 * canonical trigger-info outputs (rows missing from the saved node data are
 * backfilled, so specs authored before the defaults existed still export
 * them); every other step type exports its outputs verbatim.
 */
export function extractStepOutputParams(
  nodeType: string,
  data: Record<string, unknown>,
): OutputParameterSpecification[] | undefined {
  if (nodeType !== 'catch') return extractOutputParams(data)
  return extractOutputParams({ outputs: withCanonicalCatchOutputs(data.outputs as ParameterSpec[] | undefined) })
}

/**
 * Extracts output parameter specifications from spec data.
 */
export function extractOutputParams(data: Record<string, unknown>): OutputParameterSpecification[] | undefined {
  const outputs = data.outputs as
    | Array<{
        id: string
        name: string
        description?: string
        target?: string
        entries?: Array<{ name: string; value: string }>
      }>
    | undefined
  if (!outputs || outputs.length === 0) return undefined

  return outputs.map((output) => ({
    id: output.name,
    oid: output.id,
    description: output.description ?? output.entries?.find((e) => e.name === 'Description')?.value,
    // If no explicit target is set, default to the output's own name so the
    // runtime engine stores the value under that key in the property store.
    target: output.target || output.name,
    entries: output.entries?.map((e) => ({ name: e.name, value: e.value })),
  }))
}

/**
 * Extracts property specifications from spec data.
 */
export function extractPropertySpecs(data: Record<string, unknown>): PropertySpecification[] | undefined {
  const values = data.values as
    | Array<{ id: string; name: string; entries: Array<{ name: string; value: string }> }>
    | undefined
  if (!values || values.length === 0) return undefined

  return values.map((value) => ({
    name: value.name,
    oid: value.id,
    entries: (value.entries || []).map((e) => ({ name: e.name, value: e.value })),
  }))
}

/**
 * Extracts action property specifications from spec data.
 */
export function extractActionPropertySpecs(data: Record<string, unknown>): PropertySpecification[] | undefined {
  const values = data.actionProperties as
    | Array<{ id: string; name: string; entries: Array<{ name: string; value: string }> }>
    | undefined
  if (!values || values.length === 0) return undefined

  return values.map((value) => ({
    name: value.name,
    oid: value.id,
    entries: (value.entries || []).map((e) => ({ name: e.name, value: e.value })),
  }))
}

/**
 * Extracts Value Type specifications from environment data (data.valueTypes).
 * Designer-only: callers gate emission behind EnvExportOptions.includeValueTypes.
 */
export function extractValueTypeSpecs(data: Record<string, unknown>): ValueTypeSpecification[] | undefined {
  const valueTypes = data.valueTypes as
    | Array<{
        id: string
        name: string
        description?: string
        entries: Array<{ name: string; defaultValue?: string }>
      }>
    | undefined
  if (!valueTypes || valueTypes.length === 0) return undefined

  return valueTypes.map((vt) => ({
    name: vt.name,
    oid: vt.id,
    ...(vt.description ? { description: vt.description } : {}),
    entries: (vt.entries || []).map((e) => ({
      name: e.name,
      ...(e.defaultValue ? { value: e.defaultValue } : {}),
    })),
  }))
}

/**
 * Extracts workflow-level resource property specifications from spec data.
 * Converts internal ResourceSpec format to export ResourcePropertySpecification format.
 */
export function extractWorkflowResourceSpecs(
  data: Record<string, unknown>,
): ResourcePropertySpecification[] | undefined {
  const resources = data.workflowResources as
    | Array<{
        name: string
        resourceType: string
        count: number
        description?: string
        names?: string[]
      }>
    | undefined
  if (!resources || resources.length === 0) return undefined

  const mapResourceType = (type: string): ResourcePropertySpecification['resource_type'] => {
    switch (type) {
      case 'Single Use':
        return 'binary exclusive use'
      case 'Shared Use':
        return 'binary shared use with pool limits'
      case 'Count Limited':
        return 'countable use with pool limits'
      case 'Named':
        return 'named pool'
      case 'Sync':
        return 'sync'
      default:
        return type as ResourcePropertySpecification['resource_type']
    }
  }

  return resources.map((res) => ({
    name: res.name,
    resource_type: mapResourceType(res.resourceType),
    scope: 'workflow' as const,
    use_limit: res.count > 1 ? res.count : undefined,
    description: res.description,
    ...(res.names && res.names.length > 0 ? { names: res.names } : {}),
  }))
}
