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

// IMPORTANT: This module is the lazy boundary for `jszip`. Always reach it
// via `await import('@/lib/envir-bundle')` from app code (see
// `useGenerateEnvironmentReport`). If a static import is added from any
// module in the main bundle path, jszip (~100 KB) ships in the initial
// chunk, breaking the bundle-weight goal.

import JSZip from 'jszip'

export interface BundleManifest {
  format: 'WFenvirBundleX'
  format_version: number
  exported_at: string
  container_version: string
  environment_oid: string
  environment_local_id: string
  action_count: number
  code_file_count: number
}

export interface BundleParameterSpec {
  id: string
  value_type: string
  default_value: string
  description: string | null
}

export interface BundleEnvironment {
  oid: string
  local_id: string
  version: string
  description: string | null
  last_modified_date: string | null
  action_property_specifications: BundleParameterSpec[]
}

// Wire-format shape used only inside parseEnvirBundle.
// Fields that may be absent in the raw JSON are optional here; the parser
// normalises them to always-present arrays before returning EnvirBundle.
interface BundleEnvironmentInput {
  oid: string
  local_id: string
  version: string
  description: string | null
  last_modified_date: string | null
  action_property_specifications?: BundleParameterSpec[]
  included_actions?: BundleAction[]
}

export interface BundleAction {
  oid: string
  local_id: string
  version: string
  action_visibility: 'observable' | 'opaque'
  description: string | null
  input_parameter_specifications: BundleParameterSpec[]
  output_parameter_specifications: BundleParameterSpec[]
}

export interface BundleActionEntry {
  record: BundleAction
  code: Record<string, string>
}

export interface EnvirBundle {
  manifest: BundleManifest
  environment: BundleEnvironment
  actions: BundleActionEntry[]
}

export async function parseEnvirBundle(blob: Blob): Promise<EnvirBundle> {
  const buffer = await blob.arrayBuffer()
  const zip = await JSZip.loadAsync(buffer)

  // 1) Manifest
  const manifestEntry = zip.file('manifest.json')
  if (!manifestEntry) {
    throw new Error('Bundle is missing manifest.json')
  }
  const manifest = JSON.parse(await manifestEntry.async('text')) as BundleManifest

  // 2) Inner .WFenvir
  const innerEntry = Object.values(zip.files).find((entry) => {
    if (entry.dir) return false
    if (entry.name === 'manifest.json') return false
    return entry.name.toLowerCase().endsWith('.wfenvir')
  })
  if (!innerEntry) {
    throw new Error('Bundle has no inner *.WFenvir entry')
  }
  const lib = JSON.parse(await innerEntry.async('text')) as {
    environment_specifications: Array<Record<string, unknown>>
  }
  if (
    !Array.isArray(lib.environment_specifications) ||
    lib.environment_specifications.length === 0
  ) {
    throw new Error('Inner .WFenvir has empty or missing environment_specifications')
  }
  const envSpec = lib.environment_specifications[0] as unknown as BundleEnvironmentInput

  // 3) Code files
  const codeByActionOid: Record<string, Record<string, string>> = {}
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue
    const match = /^code\/([^/]+)\/([^/]+)\.py$/.exec(entry.name)
    if (!match) continue
    const [, actionOid, state] = match
    ;(codeByActionOid[actionOid!] ??= {})[state!] = await entry.async('text')
  }

  // 4) Assemble action entries
  const actions: BundleActionEntry[] = (envSpec.included_actions ?? []).map((a) => ({
    record: a,
    code: codeByActionOid[a.oid] ?? {},
  }))

  return {
    manifest,
    environment: {
      oid: envSpec.oid,
      local_id: envSpec.local_id,
      version: envSpec.version,
      description: envSpec.description,
      last_modified_date: envSpec.last_modified_date,
      action_property_specifications: envSpec.action_property_specifications ?? [],
    },
    actions,
  }
}
