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

// Server-side workflow envelope parser — v7.0 only.
//
// Input:  raw JSON text from the imported ZIP's envelope entry
// Output: ImportPlan — a normalized, source-id-keyed structure that the
//         import handler converts into a BatchSaveRequest with new ids.
//
// Only the v7.0 recursive `MasterWorkflowSpecification` envelope is accepted.
// The flat v3.0 envelope (and its server-side builder) was removed once the
// import side moved fully onto the runtime contract — anything older fails
// with `unsupported_schema_version`.

import { importWorkflowSpecToInternal } from '@/lib/import/workflow-importers'
import type { MasterWorkflowSpecification } from '@/lib/packageFormat/export-types'
import { CURRENT_DATA_SCHEMA_VERSION } from '@/lib/data-schema-version'
import { CURRENT_SCHEMA_VERSION } from '@/lib/packageFormat/export-types'
import { readTypeName } from '@/lib/packageFormat/type-name'

export class EnvelopeParseError extends Error {
  constructor(
    public code: string,
    public extra?: Record<string, unknown>,
  ) {
    super(code)
    this.name = 'EnvelopeParseError'
  }
}

export interface ImportSpec {
  /** ID as it appears in the source file. The handler remaps this to a new id at insert time. */
  sourceId: string
  /** Source-file parent ref (or null for the root). */
  parentSourceId: string | null
  /** Source-file root ref. */
  rootSourceId: string
  name: string
  description: string | null
  /** Optional ISA 88 type from the package's `type_name`; null when absent/invalid. */
  typeName?: string | null
  version: string
  state: string
  /** JSON-stringified `data` blob with proxy refs stripped (they go to proxyRefs[]). */
  dataJson: string
  dataSchemaVersion: number
}

export interface ImportProxyRef {
  parentSourceId: string
  nodeId: string
  targetSourceId: string
}

export interface ImportImageRef {
  specSourceId: string
  filename: string
}

export interface ImportSpecEnv {
  /** Source-file spec id. The handler remaps this via idMap at insert time. */
  specSourceId: string
  /** Target environment-library id, preserved verbatim from the source envelope. */
  environmentLibraryId: string
}

/**
 * Phase 2 (v7.0): per-spec env-library link by NAME instead of by id. The v7
 * envelope shape carries `library_name` on each embedded env spec but not the
 * library's id (which would be meaningless across systems). The import handler
 * resolves these names to ids after env-library auto-create.
 */
export interface ImportPendingEnvLink {
  specSourceId: string
  libraryName: string
}

export interface ImportPlan {
  specs: ImportSpec[]
  proxyRefs: ImportProxyRef[]
  imageRefs: ImportImageRef[]
  specEnvs: ImportSpecEnv[]
  pendingEnvLibraryLinks: ImportPendingEnvLink[]
}

function fail(code: string, extra?: Record<string, unknown>): never {
  throw new EnvelopeParseError(code, extra)
}

/**
 * Runs importWorkflowSpecToInternal, surfacing a step's invalid form_document (thrown by
 * transformWorkflowSpec) as this parser's own EnvelopeParseError shape rather than letting
 * it escape as an uncaught exception past the import handler.
 */
function importSpecOrFail(
  spec: MasterWorkflowSpecification,
  now: number,
): ReturnType<typeof importWorkflowSpecToInternal> {
  try {
    return importWorkflowSpecToInternal(spec, now)
  } catch (e) {
    if (e instanceof EnvelopeParseError) throw e
    fail('invalid_form_document', { reason: e instanceof Error ? e.message : String(e) })
  }
}

export function parseWorkflowEnvelope(jsonText: string): ImportPlan {
  let raw: unknown
  try {
    raw = JSON.parse(jsonText)
  } catch {
    fail('json_envelope_invalid', { reason: 'not parseable JSON' })
  }
  if (!raw || typeof raw !== 'object') fail('json_envelope_invalid', { reason: 'not an object' })

  const env = raw as Record<string, unknown>
  const sv = typeof env.schemaVersion === 'string' ? env.schemaVersion : ''
  if (!sv) fail('json_envelope_invalid', { reason: 'missing schemaVersion' })
  const major = parseFloat(sv)
  if (Number.isNaN(major)) fail('json_envelope_invalid', { reason: 'invalid schemaVersion', schemaVersion: sv })
  // Only the v7.0 envelope (schemaVersion >= 4.0) is accepted. The pre-v7 flat
  // v3.0 envelope was removed when the import side moved fully onto the
  // runtime contract.
  if (major < 4.0) fail('unsupported_schema_version', { schemaVersion: sv })
  // Upper bound: Mission Designer emits CURRENT_SCHEMA_VERSION and must not silently
  // accept (and drop fields from) a package produced by a NEWER Mission Designer.
  if (major > parseFloat(CURRENT_SCHEMA_VERSION)) fail('unsupported_schema_version', { schemaVersion: sv })

  return parseV7Envelope(env)
}

// ---------------------------------------------------------------------------
// v7.0 recursive parser.
//
// The runtime contract is a single recursive MasterWorkflowSpecification at
// the envelope root. We:
//   1. Convert the root spec to internal editor shape via the lifted importer.
//   2. Walk `children[]` — the only accepted child source since v7.0.
//      The deprecated `child_workflows[]` field is silently dropped; a warning
//      is emitted when it is the only child source present.
//   3. Extract proxy refs and image refs from the converted data of every
//      spec, emitting an ImportPlan compatible with buildImportBatch.
// ---------------------------------------------------------------------------

interface V7Child {
  oid: string
  local_id?: string
  parentChildSpecId?: string | null
  steps?: unknown[]
  connections?: unknown[]
  children?: V7Child[]
  description?: string
  type_name?: unknown
  version?: string
  state?: string
}

function parseV7Envelope(env: Record<string, unknown>): ImportPlan {
  const oid = typeof env.oid === 'string' ? env.oid : ''
  const localId = typeof env.local_id === 'string' ? env.local_id : ''
  if (!oid) fail('json_envelope_invalid', { reason: 'v7 root spec missing oid' })
  if (!localId) fail('json_envelope_invalid', { reason: 'v7 root spec missing local_id' })

  const specs: ImportSpec[] = []
  const proxyRefs: ImportProxyRef[] = []
  const imageRefs: ImportImageRef[] = []
  const specEnvs: ImportSpecEnv[] = []
  const pendingEnvLibraryLinks: ImportPendingEnvLink[] = []

  // Convert + emit root.
  const rootInternal = importSpecOrFail(env as unknown as MasterWorkflowSpecification, Date.now())
  const rootCleaned = extractRefsAndClean(rootInternal.data, oid, proxyRefs, imageRefs)
  specs.push({
    sourceId: oid,
    parentSourceId: null,
    rootSourceId: oid,
    name: localId,
    description: typeof env.description === 'string' ? env.description : null,
    typeName: readTypeName(env.type_name),
    version: typeof env.version === 'string' ? env.version : '1.0.0',
    state: typeof env.state === 'string' ? env.state : 'Draft',
    dataJson: JSON.stringify(rootCleaned),
    dataSchemaVersion: CURRENT_DATA_SCHEMA_VERSION,
  })

  collectV7SpecEnvs(env, oid, specEnvs, pendingEnvLibraryLinks)

  // Deprecated 'child_workflows' field is silently dropped; only 'children' is accepted.
  if (!Array.isArray(env.children) && Array.isArray(env.child_workflows)) {
    console.warn('parseEnvelope: legacy child_workflows field present and dropped; use children')
  }
  const childrenSource: V7Child[] = Array.isArray(env.children) ? (env.children as V7Child[]) : []

  walkV7Children(childrenSource, oid, oid, specs, proxyRefs, imageRefs, specEnvs, pendingEnvLibraryLinks)

  return { specs, proxyRefs, imageRefs, specEnvs, pendingEnvLibraryLinks }
}

function walkV7Children(
  children: V7Child[],
  parentSourceId: string,
  rootSourceId: string,
  specs: ImportSpec[],
  proxyRefs: ImportProxyRef[],
  imageRefs: ImportImageRef[],
  specEnvs: ImportSpecEnv[],
  pendingEnvLibraryLinks: ImportPendingEnvLink[],
): void {
  for (const child of children) {
    if (!child || typeof child !== 'object') continue
    if (typeof child.oid !== 'string' || !child.oid) continue

    const childInternal = importSpecOrFail(child as unknown as MasterWorkflowSpecification, Date.now())
    const cleaned = extractRefsAndClean(childInternal.data, child.oid, proxyRefs, imageRefs)

    // parentChildSpecId on a v7 ChildWorkflowExport: null = direct child of root,
    // otherwise = oid of the parent ChildWorkflowExport. Map back to ImportSpec's
    // parentSourceId, falling back to the explicit parentSourceId we're walking
    // when the field is absent (resilience to imperfect exports).
    const explicitParent = child.parentChildSpecId ?? null
    const resolvedParentSourceId = explicitParent === null ? rootSourceId : explicitParent

    specs.push({
      sourceId: child.oid,
      parentSourceId: resolvedParentSourceId || parentSourceId,
      rootSourceId,
      name: typeof child.local_id === 'string' ? child.local_id : child.oid,
      description: typeof child.description === 'string' ? child.description : null,
      typeName: readTypeName(child.type_name),
      version: typeof child.version === 'string' ? child.version : '1.0.0',
      state: typeof child.state === 'string' ? child.state : 'Draft',
      dataJson: JSON.stringify(cleaned),
      dataSchemaVersion: CURRENT_DATA_SCHEMA_VERSION,
    })

    collectV7SpecEnvs(child as unknown as Record<string, unknown>, child.oid, specEnvs, pendingEnvLibraryLinks)

    if (Array.isArray(child.children) && child.children.length > 0) {
      walkV7Children(
        child.children,
        child.oid,
        rootSourceId,
        specs,
        proxyRefs,
        imageRefs,
        specEnvs,
        pendingEnvLibraryLinks,
      )
    }
  }
}

function collectV7SpecEnvs(
  spec: Record<string, unknown>,
  sourceId: string,
  out: ImportSpecEnv[],
  pendingLinks: ImportPendingEnvLink[],
): void {
  const envSpecs = spec.environment_specifications
  if (!Array.isArray(envSpecs)) return
  const seenLibNames = new Set<string>()
  for (const e of envSpecs) {
    if (!e || typeof e !== 'object') continue
    const envObj = e as Record<string, unknown>

    // Direct id link (rare on v7 — the schema embeds env specs by name, not by
    // library id — but accepted for forward-compat with payloads that carry it).
    const explicitId = envObj.environmentLibraryId
    if (typeof explicitId === 'string' && explicitId.length > 0) {
      out.push({ specSourceId: sourceId, environmentLibraryId: explicitId })
      continue
    }

    // v7 path: link by library_name. The import handler resolves names to ids
    // after env-library auto-create from the ZIP's environments/ subdirectory.
    const libraryName = envObj.library_name
    if (typeof libraryName === 'string' && libraryName.length > 0) {
      // Dedupe per spec — multiple env specs may belong to the same env library.
      if (seenLibNames.has(libraryName)) continue
      seenLibNames.add(libraryName)
      pendingLinks.push({ specSourceId: sourceId, libraryName })
    }
  }
}

/**
 * Extract proxy refs and image refs from already-converted internal data, returning
 * a cleaned data object suitable for JSON.stringify into ImportSpec.dataJson.
 *
 * The internal data shape (post-importWorkflowSpecToInternal) has `nodes[]` with
 * `data: StepNodeData`. workflowProxy nodes carry `data.embeddedWorkflowSpecId`
 * for embedded children; form-bearing steps carry `data.formLayouts.{phone|tablet|
 * desktop}.elements[]` (v1) and/or `data.formDocument.sections[].rows[].blocks[]`
 * (v2) with `src`/`imageOid` for image elements. A legacy step converted at import
 * time carries both shapes over the same filenames — the v2 walk dedupes against
 * refs the v1 walk already collected for the same spec.
 */
function extractRefsAndClean(
  data: Record<string, unknown>,
  specSourceId: string,
  proxyRefs: ImportProxyRef[],
  imageRefs: ImportImageRef[],
): Record<string, unknown> {
  const nodesRaw = data.nodes
  if (!Array.isArray(nodesRaw)) return data

  const cleanedNodes: unknown[] = []
  for (const rawNode of nodesRaw) {
    if (!rawNode || typeof rawNode !== 'object') {
      cleanedNodes.push(rawNode)
      continue
    }
    const node = { ...(rawNode as Record<string, unknown>) }
    const nodeId = typeof node.id === 'string' ? node.id : ''
    const nodeData = node.data && typeof node.data === 'object' ? { ...(node.data as Record<string, unknown>) } : null

    // Embedded workflow proxy refs may be carried at either node.embeddedWorkflowSpecId
    // (legacy v3 inline) or node.data.embeddedWorkflowSpecId (post-import shape).
    if (nodeId && typeof node.embeddedWorkflowSpecId === 'string') {
      proxyRefs.push({ parentSourceId: specSourceId, nodeId, targetSourceId: node.embeddedWorkflowSpecId })
      delete node.embeddedWorkflowSpecId
    }
    if (nodeId && nodeData && typeof nodeData.embeddedWorkflowSpecId === 'string') {
      proxyRefs.push({
        parentSourceId: specSourceId,
        nodeId,
        targetSourceId: nodeData.embeddedWorkflowSpecId as string,
      })
      delete nodeData.embeddedWorkflowSpecId
    }

    // Image refs from the v7 hydrated formLayouts (record as bare filename — the
    // ZIP layer applies the imageOid prefix and import-side reverses it).
    const formLayouts = nodeData?.formLayouts
    if (formLayouts && typeof formLayouts === 'object') {
      for (const deviceKey of ['phone', 'tablet', 'desktop'] as const) {
        const layout = (formLayouts as Record<string, unknown>)[deviceKey]
        if (!layout || typeof layout !== 'object') continue
        const elements = (layout as { elements?: unknown }).elements
        if (!Array.isArray(elements)) continue
        for (const el of elements) {
          if (!el || typeof el !== 'object') continue
          const elObj = el as Record<string, unknown>
          if (elObj.type !== 'image') continue
          const src = elObj.src
          if (typeof src !== 'string' || !src) continue
          // src has been stripped of imageOid prefix by hydrateFormLayouts.
          imageRefs.push({ specSourceId, filename: src })
        }
      }
    }

    // Image refs from the v2 formDocument (native 5.0 imports and converted legacy alike).
    const formDocument = nodeData?.formDocument as
      | { sections?: Array<{ rows?: Array<{ blocks?: Array<Record<string, unknown>> }> }> }
      | undefined
    if (formDocument?.sections) {
      for (const section of formDocument.sections) {
        for (const row of section.rows ?? []) {
          for (const block of row.blocks ?? []) {
            if (block.type !== 'image') continue
            const src = block.src
            if (typeof src !== 'string' || !src || src === 'No image selected') continue
            if (/^https?:/.test(src) || src.startsWith('data:')) continue
            // A converted legacy step carries both the v1 formLayouts walk above and
            // this v2 walk over the same filenames — dedupe so it isn't double-counted.
            // The v1 push above stays unguarded (byte-identical to pre-v2 behavior).
            if (!imageRefs.some((r) => r.specSourceId === specSourceId && r.filename === src)) {
              imageRefs.push({ specSourceId, filename: src })
            }
          }
        }
      }
    }

    if (nodeData) node.data = nodeData
    cleanedNodes.push(node)
  }

  return { ...data, nodes: cleanedNodes }
}
