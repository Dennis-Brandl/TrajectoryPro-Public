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

import { EngineError } from '../errors.js'

/**
 * Resolve input parameters by merging provided values with spec defaults.
 *
 * @param provided - Parameters from InvokeRequest (name -> value pairs)
 * @param specs - Action input_parameter_specifications (unknown[] from storage)
 * @returns Array of { key, value } pairs for storage in InstanceRepository
 * @throws EngineError('PARAMETER_VALIDATION_FAILED') if a required param is missing
 */
export function resolveInputParameters(
  provided: Array<{ name: string; value: string }>,
  specs: unknown[]
): Array<{ key: string; value: string }> {
  const typedSpecs = specs as Array<{
    id: string
    default_value?: string | null
    json_schema?: string
  }>

  // Build a Map from provided parameters for O(1) lookup
  const providedMap = new Map<string, string>()
  for (const param of provided) {
    providedMap.set(param.name, param.value)
  }

  const result: Array<{ key: string; value: string }> = []
  const specNames = new Set<string>()

  for (const spec of typedSpecs) {
    specNames.add(spec.id)

    if (providedMap.has(spec.id)) {
      // Use provided value
      result.push({ key: spec.id, value: providedMap.get(spec.id)! })
    } else if (spec.default_value !== undefined && spec.default_value !== null) {
      // Use default value
      result.push({ key: spec.id, value: spec.default_value })
    } else {
      // Missing required parameter
      throw new EngineError('PARAMETER_VALIDATION_FAILED', `Missing required parameter: ${spec.id}`)
    }
  }

  // Include any extra provided parameters not in specs (pass-through)
  for (const [name, value] of providedMap) {
    if (!specNames.has(name)) {
      result.push({ key: name, value })
    }
  }

  return result
}

/**
 * Merge per-invoke property overrides into a flattened property map.
 *
 * Used for the `action_property_overrides` invoke-request field — a test/dev
 * affordance that lets a single invocation see a different value for a named
 * property (e.g. flipping `SIMULATION_MODE.Value` to `'true'`) without
 * mutating the environment record on disk.
 *
 * Merge semantics (one level deep):
 *   - For each top-level key in `overrides`, merge its inner Record into the
 *     base's inner Record. Entry-level keys in the override win.
 *   - Top-level keys present only in `overrides` are added.
 *   - The base is treated as immutable; a new object is returned.
 *
 * @param base - The flattened props from `flattenProperties(env.action_property_specifications)`.
 * @param overrides - Override map with the same shape; entries here win over base.
 * @returns A new merged Record (does not mutate either argument).
 */
export function mergePropertyOverrides(
  base: Record<string, Record<string, string>>,
  overrides: Record<string, Record<string, string>>
): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {}
  for (const [specName, entries] of Object.entries(base)) {
    result[specName] = { ...entries }
  }
  for (const [specName, overrideEntries] of Object.entries(overrides)) {
    result[specName] = { ...(result[specName] ?? {}), ...overrideEntries }
  }
  return result
}

/**
 * Flatten nested property specifications into a two-level Record.
 *
 * @param specs - Property specifications (unknown[] from storage)
 *   Expected shape: Array<{ name: string; entries: Array<{ name: string; value: string }> }>
 * @returns Record<string, Record<string, string>> — outer key is spec.name, inner is entry.name -> entry.value
 */
export function flattenProperties(specs: unknown[]): Record<string, Record<string, string>> {
  if (!specs || specs.length === 0) return {}

  const typedSpecs = specs as Array<{
    name: string
    entries: Array<{ name: string; value: string }>
  }>

  const result: Record<string, Record<string, string>> = {}

  for (const spec of typedSpecs) {
    if (!spec || typeof spec.name !== 'string') continue

    const inner: Record<string, string> = {}
    if (Array.isArray(spec.entries)) {
      for (const entry of spec.entries) {
        if (entry && typeof entry.name === 'string') {
          inner[entry.name] = entry.value
        }
      }
    }
    result[spec.name] = inner
  }

  return result
}
