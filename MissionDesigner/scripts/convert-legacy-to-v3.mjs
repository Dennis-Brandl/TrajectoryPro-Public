#!/usr/bin/env node
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
 * Converts a legacy .WFmasterX file (schemaVersion 4.0, flat steps/connections)
 * to the v2 server import format (schemaVersion 3.0, library/specifications[] tree).
 *
 * Usage:
 *   node scripts/convert-legacy-to-v3.mjs [path/to/file.WFmasterX]
 *
 * If no path is given, pops up a native Windows file picker.
 * The input file is overwritten in-place.
 *
 * Conversions performed:
 *   - Legacy schemaVersion "4.0" → envelope schemaVersion "3.0"
 *   - Flat steps/connections → specification.data.{nodes, edges}
 *   - step_type strings → v3 node type ('START' → 'start', etc.)
 *   - child_workflows (recursive) → nested specifications with parent/root ids
 *   - form_layout_config → node.data.formLayouts, image elements rename src → image
 *     and re-prefix filename with the owning step's oid so parseEnvelope can strip it
 *   - WORKFLOW PROXY steps get embeddedWorkflowSpecId pointing to the child oid
 *   - Images under `images/` are carried through unchanged (already step-oid-prefixed)
 *   - manifest.json and environments/ are dropped (v3 doesn't use them)
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'
import JSZip from 'jszip'

// ─── Step type mapping (mirrors src/lib/import/type-mapping.ts) ──────────────

const STEP_TYPE_TO_NODE_TYPE = {
  START: 'start',
  END: 'end',
  'ACTION PROXY': 'actionProxyWait',
  'WAIT ACTION PROXY': 'actionProxyWait',
  'NOWAIT ACTION PROXY': 'actionProxyWait',
  'WORKFLOW PROXY': 'workflowProxy',
  'SELECT 1': 'select1',
  'WAIT ANY': 'waitAny',
  PARALLEL: 'parallel',
  'WAIT ALL': 'waitAll',
  MATH: 'actionProxyWait',
  SCRIPT: 'scriptStep',
  YES_NO: 'yesNoStep',
  USER_INTERACTION: 'userInteractionStep',
}

// ─── File picker (PowerShell, Windows native) ────────────────────────────────

function pickFileWithPowerShell() {
  const ps = `
Add-Type -AssemblyName System.Windows.Forms
$dlg = New-Object System.Windows.Forms.OpenFileDialog
$dlg.Filter = 'Legacy workflow packages (*.WFmasterX)|*.WFmasterX|All files (*.*)|*.*'
$dlg.Title  = 'Select a legacy WFmasterX to convert'
if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $dlg.FileName } else { '' }
`.trim()
  try {
    const out = execSync(`powershell -NoProfile -STA -Command "${ps.replace(/"/g, '\\"')}"`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    return out.trim()
  } catch {
    return ''
  }
}

// ─── Edge id generator (lightweight, no snowflake lib needed) ────────────────

let edgeCounter = 0
function newEdgeId() {
  edgeCounter += 1
  return `e-${Date.now().toString(36)}-${edgeCounter}`
}

// ─── Form layout conversion ──────────────────────────────────────────────────

const LAYOUT_DEFAULTS = {
  phone: { w: 390, h: 844 },
  tablet: { w: 768, h: 1024 },
  desktop: { w: 768, h: 1024 },
}

function convertFormLayoutConfig(formLayoutConfig, stepOid) {
  if (!Array.isArray(formLayoutConfig) || formLayoutConfig.length === 0) return undefined

  // v3 server parseEnvelope expects formLayouts as an ARRAY of per-device layouts,
  // each including deviceType, canvasWidth, canvasHeight, elements.
  const byDevice = {}
  for (const layout of formLayoutConfig) {
    if (!layout || typeof layout !== 'object' || !layout.deviceType) continue
    byDevice[layout.deviceType] = layout
  }

  const out = []
  for (const deviceType of ['phone', 'tablet', 'desktop']) {
    const src = byDevice[deviceType]
    const defaults = LAYOUT_DEFAULTS[deviceType] || LAYOUT_DEFAULTS.phone
    const elements = Array.isArray(src?.elements) ? src.elements : []
    out.push({
      deviceType,
      canvasWidth: typeof src?.canvasWidth === 'number' ? src.canvasWidth : defaults.w,
      canvasHeight: typeof src?.canvasHeight === 'number' ? src.canvasHeight : defaults.h,
      elements: elements.map((el) => convertFormElement(el, stepOid)),
    })
  }
  return out
}

function convertFormElement(el, stepOid) {
  if (!el || typeof el !== 'object') return el
  const out = { ...el }
  // Give every element a stable id (required by v3)
  if (!out.id) out.id = `${stepOid}-el-${Math.random().toString(36).slice(2, 10)}`

  // Image elements: legacy has `src: "<filename>"` (plain); v3 parseEnvelope
  // expects `image: "<stepOid>-<filename>"` (prefixed) and strips the prefix at import.
  if (out.type === 'image' && typeof out.src === 'string' && out.src) {
    const hasPrefix = out.src.startsWith(`${stepOid}-`)
    out.image = hasPrefix ? out.src : `${stepOid}-${out.src}`
    delete out.src
  }

  // Text/header content may be a plain string (Phase 23+) or {content, plainText} (Phase 15).
  // Leave as-is — hydrateFormLayouts handles both on the receiving side.

  return out
}

// ─── Step → node conversion ──────────────────────────────────────────────────

function convertStepToNode(step, workflow, childWorkflowOidByLocalId) {
  const nodeType = STEP_TYPE_TO_NODE_TYPE[step.step_type] || 'actionProxyWait'

  const data = {
    label: step.local_id || '',
    stepType: nodeType,
  }
  if (step.description) data.description = step.description
  if (Array.isArray(step.input_parameter_specifications)) {
    data.inputs = step.input_parameter_specifications
  }
  if (Array.isArray(step.output_parameter_specifications)) {
    data.outputs = step.output_parameter_specifications
  }
  if (Array.isArray(step.value_property_specifications)) {
    data.values = step.value_property_specifications
  }
  if (Array.isArray(step.resource_command_specifications)) {
    data.resourceCommands = step.resource_command_specifications
  }
  if (Array.isArray(step.ui_parameter_specifications)) {
    data.uiParameters = step.ui_parameter_specifications
  }

  // Yes/No config
  if (step.yes_no_config && typeof step.yes_no_config === 'object') {
    const y = step.yes_no_config
    data.yesNoYesValue = 'true'
    data.yesNoNoValue = 'false'
    if (y.default_selection !== undefined) data.yesNoDefaultSelection = y.default_selection
    if (y.yes_label !== undefined) data.yesNoYesLabel = y.yes_label
    if (y.no_label !== undefined) data.yesNoNoLabel = y.no_label
  }

  // Script config
  if (step.script_config && typeof step.script_config === 'object') {
    if (step.script_config.language !== undefined) data.scriptLanguage = step.script_config.language
    if (step.script_config.source !== undefined) data.scriptSource = step.script_config.source
  }

  // Select 1 config
  if (step.select1_config && typeof step.select1_config === 'object') {
    const s = step.select1_config
    if (s.input_name !== undefined) data.select1InputName = s.input_name
    if (s.input_value_type !== undefined) data.select1InputValueType = s.input_value_type
    if (Array.isArray(s.options)) {
      data.select1Options = s.options.map((o) => ({
        id: o.id,
        label: o.label,
        operator: o.operator,
        value: o.value,
        valueType: o.value_type,
        isDefault: !!o.is_default,
      }))
    }
  }

  if (step.action_visibility) data.actionVisibility = step.action_visibility

  // Form layouts. Stored in TWO locations:
  //   - `node.data.formLayouts` — where the editor reads from when rendering
  //   - `node.formLayouts` — where the server's parseEnvelope walks to extract image refs
  // The duplication is intentional; the v3 format has no single location that satisfies both.
  const layouts = convertFormLayoutConfig(step.form_layout_config, step.oid)
  if (layouts) data.formLayouts = layouts

  const node = {
    id: step.oid,
    type: nodeType,
    position: step.position || { x: 100, y: 100 },
    data,
  }
  if (layouts) node.formLayouts = layouts

  // Workflow proxy: link to embedded child workflow.
  // Legacy convention: the proxy step's `local_id` matches a child_workflow's `local_id`.
  // Fall back to explicit field names if present.
  if (nodeType === 'workflowProxy') {
    const explicit =
      step.embedded_workflow_local_id ||
      step.child_workflow_local_id ||
      step.child_workflow_oid ||
      step.embedded_workflow_oid ||
      null
    let resolved = null
    if (explicit) {
      resolved = childWorkflowOidByLocalId.get(explicit) || explicit
    } else if (step.local_id && childWorkflowOidByLocalId.has(step.local_id)) {
      resolved = childWorkflowOidByLocalId.get(step.local_id)
    }
    if (resolved) {
      // Same two-location dance as formLayouts: parseEnvelope reads top-level, editor reads node.data.
      node.embeddedWorkflowSpecId = resolved
      data.embeddedWorkflowSpecId = resolved
      data.subWorkflowMode = 'embedded'
    }
  }

  return node
}

function convertConnectionToEdge(conn) {
  const data =
    conn.condition || conn.waypoints || conn.connection_id
      ? {
          ...(conn.condition ? { condition: conn.condition } : {}),
          ...(conn.waypoints ? { waypoints: conn.waypoints } : {}),
          ...(conn.connection_id ? { connectionId: conn.connection_id } : {}),
        }
      : undefined
  return {
    id: newEdgeId(),
    source: conn.from_step_id,
    target: conn.to_step_id,
    ...(conn.source_handle_id ? { sourceHandle: conn.source_handle_id } : {}),
    type: 'conditional',
    ...(data ? { data } : {}),
  }
}

// ─── Workflow → specification conversion (recursive) ─────────────────────────

function convertWorkflowToSpec(workflow, parentSpecificationId, rootSpecificationId) {
  if (!workflow.oid) {
    throw new Error(`Workflow "${workflow.local_id ?? '(unnamed)'}" has no oid — cannot convert.`)
  }
  const myRoot = rootSpecificationId || workflow.oid

  // Build a lookup of child workflow local_id → oid so WORKFLOW PROXY steps can resolve their target.
  const childWorkflowOidByLocalId = new Map()
  if (Array.isArray(workflow.child_workflows)) {
    for (const child of workflow.child_workflows) {
      if (child?.local_id && child?.oid) {
        childWorkflowOidByLocalId.set(child.local_id, child.oid)
      }
    }
  }

  const steps = Array.isArray(workflow.steps) ? workflow.steps : []
  const connections = Array.isArray(workflow.connections) ? workflow.connections : []

  const nodes = steps.map((s) => convertStepToNode(s, workflow, childWorkflowOidByLocalId))
  const edges = connections.map(convertConnectionToEdge)

  const specData = {
    nodes,
    edges,
  }
  if (workflow.viewport) specData.viewport = workflow.viewport
  if (workflow.display_style) specData.notation = workflow.display_style
  if (Array.isArray(workflow.starting_parameter_specifications)) {
    specData.workflowInputs = workflow.starting_parameter_specifications
  }
  if (Array.isArray(workflow.output_parameter_specifications)) {
    specData.workflowOutputs = workflow.output_parameter_specifications
  }
  if (Array.isArray(workflow.value_property_specifications)) {
    specData.workflowValues = workflow.value_property_specifications
  }
  if (Array.isArray(workflow.resource_property_specifications)) {
    specData.workflowResources = workflow.resource_property_specifications
  }

  const spec = {
    id: workflow.oid,
    name: workflow.local_id || 'Untitled',
    description: workflow.description ?? null,
    version: workflow.version || '1.0.0',
    state: 'Draft',
    parentSpecificationId,
    rootSpecificationId: myRoot,
    data: specData,
    dataSchemaVersion: 3,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }

  const allSpecs = [spec]

  // Recurse into child workflows, nesting them under this spec.
  if (Array.isArray(workflow.child_workflows)) {
    for (const child of workflow.child_workflows) {
      const childSpecs = convertWorkflowToSpec(child, workflow.oid, myRoot)
      allSpecs.push(...childSpecs)
    }
  }

  return allSpecs
}

// ─── Envelope build ──────────────────────────────────────────────────────────

function buildV3Envelope(legacyWorkflow) {
  const specs = convertWorkflowToSpec(legacyWorkflow, null, null)
  return {
    schemaVersion: '3.0',
    library: {
      id: legacyWorkflow.oid,
      name: legacyWorkflow.local_id || 'Imported Workflow',
      entityType: 'workflow',
      description: legacyWorkflow.description ?? null,
      version: legacyWorkflow.version || '1.0.0',
    },
    specifications: specs,
  }
}

// ─── ZIP rewrite ─────────────────────────────────────────────────────────────

async function convertZipBuffer(buffer) {
  const zip = await JSZip.loadAsync(buffer)

  // Find the legacy envelope entry.
  const entryNames = Object.keys(zip.files)
  const legacyEnvelopeName = entryNames.find(
    (n) => !zip.files[n].dir && n.endsWith('.WFmaster') && !n.startsWith('environments/'),
  )
  if (!legacyEnvelopeName) {
    throw new Error('No .WFmaster envelope entry found in the ZIP (expected a top-level *.WFmaster file).')
  }

  const legacyText = await zip.file(legacyEnvelopeName).async('string')
  const legacy = JSON.parse(legacyText)

  if (typeof legacy.schemaVersion === 'string' && parseFloat(legacy.schemaVersion) >= 3.0 && parseFloat(legacy.schemaVersion) < 4.0) {
    throw new Error(`File already appears to be v3 (schemaVersion ${legacy.schemaVersion}) — nothing to do.`)
  }

  const envelope = buildV3Envelope(legacy)

  // Build output ZIP: new envelope + images/ (kept) ; drop manifest.json + environments/
  const out = new JSZip()
  const safeName = (legacy.local_id || 'Imported Workflow').replace(/[^A-Za-z0-9 ._-]/g, '_').slice(0, 200)
  out.file(`${safeName}.WFmaster`, JSON.stringify(envelope, null, 2))

  for (const name of entryNames) {
    const entry = zip.files[name]
    if (entry.dir) continue
    if (name === legacyEnvelopeName) continue
    if (name === 'manifest.json') continue
    if (name.startsWith('environments/')) continue
    if (!name.startsWith('images/')) continue
    const bytes = await entry.async('uint8array')
    out.file(name, bytes)
  }

  const outBytes = await out.generateAsync({ type: 'uint8array' })
  return { bytes: Buffer.from(outBytes), specCount: envelope.specifications.length }
}

// ─── Entrypoint ──────────────────────────────────────────────────────────────

async function main() {
  let filePath = process.argv[2]
  if (!filePath) {
    if (process.platform !== 'win32') {
      console.error('No file path given. On non-Windows, pass the path as an argument.')
      process.exit(2)
    }
    console.log('Opening file picker...')
    filePath = pickFileWithPowerShell()
    if (!filePath) {
      console.error('No file selected — aborting.')
      process.exit(1)
    }
  }

  const abs = path.resolve(filePath)
  if (!existsSync(abs)) {
    console.error(`File not found: ${abs}`)
    process.exit(1)
  }

  console.log(`Reading: ${abs}`)
  const buffer = readFileSync(abs)
  const { bytes, specCount } = await convertZipBuffer(buffer)

  writeFileSync(abs, bytes)
  console.log(`✓ Converted in place: ${abs}`)
  console.log(`  Produced ${specCount} specification${specCount === 1 ? '' : 's'} (1 root + ${specCount - 1} nested)`)
}

main().catch((err) => {
  console.error('Conversion failed:', err.message)
  if (process.env.DEBUG) console.error(err.stack)
  process.exit(1)
})
