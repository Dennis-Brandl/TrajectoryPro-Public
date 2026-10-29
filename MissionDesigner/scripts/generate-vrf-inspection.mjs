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
 * Generates a "VRF Heat Pump Inspection" workflow as a .WFmasterX ZIP file
 * importable via the Mission Designer Import Workflow button.
 *
 * Features:
 *   - USER_INTERACTION steps with WYSIWYG form_layout_config
 *   - Text input fields for recording measurements and observations
 *   - YES_NO decision steps for voltage deviation and oil leak detection
 *   - WAIT ANY for rejoining yes/no branches
 *   - Pexels free stock images for HVAC context
 *   - Automatic step splitting when content overflows the phone screen
 *
 * Usage: node scripts/generate-vrf-inspection.mjs
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const JSZip = require('jszip')

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, '..', 'test-data')

let _oidCounter = 6000000000000
function oid() {
  return String(++_oidCounter)
}
function isoNow() {
  return new Date().toISOString()
}

// ─── Image Download ──────────────────────────────────────────────────────────

const PEXELS_IMAGES = {
  'outdoor-unit.jpg': 27134985,
  'clearance-check.jpg': 20046692,
  'electrical-panel.jpg': 257736,
  'voltage-test.jpg': 17842832,
  'terminal-check.jpg': 27928762,
  'compressor-area.jpg': 16848596,
  'indoor-unit.jpg': 20046693,
}

function pexelsUrl(photoId) {
  return `https://images.pexels.com/photos/${photoId}/pexels-photo-${photoId}.jpeg?auto=compress&cs=tinysrgb&w=600`
}

async function downloadImage(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

// ─── Step & Connection Builders ──────────────────────────────────────────────

function step(localId, stepType, extras = {}) {
  return {
    local_id: localId,
    oid: oid(),
    version: '1.0.0',
    last_modified_date: isoNow(),
    step_type: stepType,
    ...extras,
  }
}

function conn(fromOid, toOid, extras = {}) {
  return { from_step_id: fromOid, to_step_id: toOid, connection_id: oid(), ...extras }
}

// ─── Layout Height Calculator ────────────────────────────────────────────────
//
// Phone canvas: 390 x 844
// Usable zone: y=130 (content start) to y=700 (button top)
// Available content height: 570 px
// Reserve 20px gap before button → max content y = 680

const CONTENT_START_Y = 130
const BUTTON_MAX_Y = 700
const MAX_CONTENT_HEIGHT = BUTTON_MAX_Y - CONTENT_START_Y - 20 // 550px

function calcHeaderHeight() {
  return 46
} // 36 + 10 gap
function calcImageHeight() {
  return 210
} // 200 + 10 gap
function calcDividerHeight() {
  return 12
} // 2 + 10 gap

function calcBodyHeight(lines) {
  return Math.max(60, lines.length * 22 + 10) + 10
}

function calcTipHeight(tip) {
  if (!tip) return 0
  return Math.max(40, Math.ceil(tip.length / 45) * 18 + 10) + 10
}

function calcInputGroupHeight(textInputs) {
  if (!textInputs || textInputs.length === 0) return 0
  return textInputs.length * 50 // 40 (field) + 10 (gap) per input (no separate label)
}

function calcTotalHeight({ image, bodyLines, tip, textInputs }) {
  let h = calcHeaderHeight() + calcDividerHeight()
  if (image) h += calcImageHeight()
  h += calcBodyHeight(bodyLines)
  h += calcTipHeight(tip)
  h += calcInputGroupHeight(textInputs)
  return h
}

// ─── Phone Layout Builders ───────────────────────────────────────────────────

/**
 * Build a phone form layout for an instruction step (no text inputs).
 */
function buildInstructionLayout({ title, image, bodyLines, tip, buttonLabel }) {
  const elements = []
  let y = CONTENT_START_Y

  elements.push({
    type: 'header',
    x: 20,
    y,
    width: 350,
    height: 36,
    content: title,
    fontSize: 22,
    fontWeight: 'bold',
    align: 'center',
  })
  y += 46

  if (image) {
    elements.push({
      type: 'image',
      x: 20,
      y,
      width: 350,
      height: 200,
      src: image,
      objectFit: 'cover',
    })
    y += 210
  }

  elements.push({
    type: 'divider',
    x: 20,
    y,
    width: 350,
    height: 2,
    thickness: 1,
    color: '#e2e8f0',
  })
  y += 12

  const bodyText = bodyLines.join('\n')
  const textHeight = Math.max(60, bodyLines.length * 22 + 10)
  elements.push({
    type: 'text',
    x: 20,
    y,
    width: 350,
    height: textHeight,
    content: bodyText,
    fontSize: 15,
  })
  y += textHeight + 10

  if (tip) {
    const tipHeight = Math.max(40, Math.ceil(tip.length / 45) * 18 + 10)
    elements.push({
      type: 'text',
      x: 20,
      y,
      width: 350,
      height: tipHeight,
      content: tip,
      fontSize: 13,
      color: '#555555',
    })
    y += tipHeight + 10
  }

  const buttonY = Math.min(Math.max(y + 10, 680), BUTTON_MAX_Y)
  elements.push({
    type: 'button',
    x: 95,
    y: buttonY,
    width: 200,
    height: 44,
    label: buttonLabel || 'Done',
    outputValue: 'continue',
  })

  return [{ deviceType: 'phone', canvasWidth: 390, canvasHeight: 844, elements }]
}

/**
 * Build a phone form layout for a recording step (header + text inputs only).
 */
function buildRecordingLayout({ title, textInputs }) {
  const elements = []
  let y = CONTENT_START_Y

  elements.push({
    type: 'header',
    x: 20,
    y,
    width: 350,
    height: 36,
    content: title,
    fontSize: 20,
    fontWeight: 'bold',
    align: 'center',
  })
  y += 46

  elements.push({
    type: 'divider',
    x: 20,
    y,
    width: 350,
    height: 2,
    thickness: 1,
    color: '#e2e8f0',
  })
  y += 12

  for (const input of textInputs) {
    elements.push({
      type: 'textInput',
      x: 20,
      y,
      width: 350,
      height: 40,
      label: input.label,
      fontSize: 16,
      placeholder: input.placeholder || 'Enter value...',
      fieldName: input.fieldName,
      required: input.required !== false,
    })
    y += 50
  }

  const buttonY = Math.min(Math.max(y + 10, 680), BUTTON_MAX_Y)
  elements.push({
    type: 'button',
    x: 95,
    y: buttonY,
    width: 200,
    height: 44,
    label: 'Done',
    outputValue: 'continue',
  })

  return [{ deviceType: 'phone', canvasWidth: 390, canvasHeight: 844, elements }]
}

/**
 * Build a combined phone layout with instruction and text inputs (when it fits).
 */
function buildCombinedLayout({ title, image, bodyLines, tip, textInputs }) {
  const elements = []
  let y = CONTENT_START_Y

  elements.push({
    type: 'header',
    x: 20,
    y,
    width: 350,
    height: 36,
    content: title,
    fontSize: 22,
    fontWeight: 'bold',
    align: 'center',
  })
  y += 46

  if (image) {
    elements.push({
      type: 'image',
      x: 20,
      y,
      width: 350,
      height: 200,
      src: image,
      objectFit: 'cover',
    })
    y += 210
  }

  elements.push({
    type: 'divider',
    x: 20,
    y,
    width: 350,
    height: 2,
    thickness: 1,
    color: '#e2e8f0',
  })
  y += 12

  const bodyText = bodyLines.join('\n')
  const textHeight = Math.max(60, bodyLines.length * 22 + 10)
  elements.push({
    type: 'text',
    x: 20,
    y,
    width: 350,
    height: textHeight,
    content: bodyText,
    fontSize: 15,
  })
  y += textHeight + 10

  if (tip) {
    const tipHeight = Math.max(40, Math.ceil(tip.length / 45) * 18 + 10)
    elements.push({
      type: 'text',
      x: 20,
      y,
      width: 350,
      height: tipHeight,
      content: tip,
      fontSize: 13,
      color: '#555555',
    })
    y += tipHeight + 10
  }

  if (textInputs && textInputs.length > 0) {
    for (const input of textInputs) {
      elements.push({
        type: 'textInput',
        x: 20,
        y,
        width: 350,
        height: 40,
        label: input.label,
        fontSize: 16,
        placeholder: input.placeholder || 'Enter value...',
        fieldName: input.fieldName,
        required: input.required !== false,
      })
      y += 50
    }
  }

  const buttonY = Math.min(Math.max(y + 10, 680), BUTTON_MAX_Y)
  elements.push({
    type: 'button',
    x: 95,
    y: buttonY,
    width: 200,
    height: 44,
    label: 'Done',
    outputValue: 'continue',
  })

  return [{ deviceType: 'phone', canvasWidth: 390, canvasHeight: 844, elements }]
}

/**
 * Build a YES_NO phone layout.
 */
function buildYesNoLayout({ title, image, questionLines, tip, yesLabel, noLabel }) {
  const elements = []
  let y = CONTENT_START_Y

  elements.push({
    type: 'header',
    x: 20,
    y,
    width: 350,
    height: 36,
    content: title,
    fontSize: 22,
    fontWeight: 'bold',
    align: 'center',
  })
  y += 46

  if (image) {
    elements.push({
      type: 'image',
      x: 20,
      y,
      width: 350,
      height: 200,
      src: image,
      objectFit: 'cover',
    })
    y += 210
  }

  elements.push({
    type: 'divider',
    x: 20,
    y,
    width: 350,
    height: 2,
    thickness: 1,
    color: '#e2e8f0',
  })
  y += 12

  const qText = questionLines.join('\n')
  const qHeight = Math.max(60, questionLines.length * 22 + 10)
  elements.push({
    type: 'text',
    x: 20,
    y,
    width: 350,
    height: qHeight,
    content: qText,
    fontSize: 15,
  })
  y += qHeight + 10

  if (tip) {
    elements.push({
      type: 'text',
      x: 20,
      y,
      width: 350,
      height: 40,
      content: tip,
      fontSize: 13,
      color: '#555555',
    })
  }

  elements.push({
    type: 'button',
    x: 20,
    y: BUTTON_MAX_Y,
    width: 160,
    height: 44,
    label: yesLabel,
    outputValue: 'true',
    deletable: false,
  })
  elements.push({
    type: 'button',
    x: 210,
    y: BUTTON_MAX_Y,
    width: 160,
    height: 44,
    label: noLabel,
    outputValue: 'false',
    deletable: false,
  })

  return [{ deviceType: 'phone', canvasWidth: 390, canvasHeight: 844, elements }]
}

// ─── Step Builders with Auto-Split ───────────────────────────────────────────

/**
 * Build ui_parameter_specifications for an instruction part.
 */
function buildInstructionUiParams({ title, image, bodyLines, tip, buttonLabel }) {
  const params = [
    { oid: oid(), type: 'Header', value: title, font_size: 22, align: 'center' },
    ...(image ? [{ oid: oid(), type: 'Image', value: image }] : []),
    { oid: oid(), type: 'Divider', value: '' },
    ...bodyLines.map((line) => ({ oid: oid(), type: 'Text', value: line, font_size: 15 })),
    ...(tip ? [{ oid: oid(), type: 'SmallText', value: tip, font_size: 13, color: '#555555' }] : []),
    { oid: oid(), type: 'Button', value: buttonLabel || 'Done' },
  ]
  return params
}

/**
 * Build ui_parameter_specifications for a recording part.
 */
function buildRecordingUiParams({ title, textInputs }) {
  const params = [
    { oid: oid(), type: 'Header', value: title, font_size: 20, align: 'center' },
    { oid: oid(), type: 'Divider', value: '' },
  ]
  for (const input of textInputs) {
    params.push({ oid: oid(), type: 'Text', value: input.label, font_size: 14 })
    params.push({ oid: oid(), type: 'TextInput', value: input.placeholder || 'Enter value...', lines: 1 })
  }
  params.push({ oid: oid(), type: 'Button', value: 'Done' })
  return params
}

/**
 * Create a USER_INTERACTION step, auto-splitting into two sequential steps if
 * the content would overflow the phone screen.
 *
 * Returns { steps: Step[], connections: Connection[] } where steps[0] is
 * the first step and steps[last] is the step to connect FROM for the next node.
 */
function instructionStep(localId, position, { title, image, bodyLines, tip, textInputs }) {
  const totalHeight = calcTotalHeight({ image, bodyLines, tip, textInputs })

  if (totalHeight <= MAX_CONTENT_HEIGHT || !textInputs || textInputs.length === 0) {
    // ── Fits on one screen ──
    const uiParams = buildInstructionUiParams({ title, image, bodyLines, tip })
    if (textInputs && textInputs.length > 0) {
      for (const input of textInputs) {
        uiParams.splice(-1, 0, { oid: oid(), type: 'Text', value: input.label, font_size: 14 })
        uiParams.splice(-1, 0, {
          oid: oid(),
          type: 'TextInput',
          value: input.placeholder || 'Enter value...',
          lines: 1,
        })
      }
    }

    const s = step(localId, 'USER_INTERACTION', {
      position,
      ui_parameter_specifications: uiParams,
      form_layout_config: buildCombinedLayout({ title, image, bodyLines, tip, textInputs }),
      ...(textInputs && textInputs.length > 0
        ? {
            output_parameter_specifications: textInputs.map((input) => ({
              id: input.fieldName,
              oid: oid(),
              description: input.label,
            })),
          }
        : {}),
    })

    return { steps: [s], connections: [] }
  }

  // ── Needs splitting ──
  // Part 1: Instruction step (header, image, body, tip) + "Next" button
  const part1 = step(localId, 'USER_INTERACTION', {
    position,
    ui_parameter_specifications: buildInstructionUiParams({
      title,
      image,
      bodyLines,
      tip,
      buttonLabel: 'Next',
    }),
    form_layout_config: buildInstructionLayout({
      title,
      image,
      bodyLines,
      tip,
      buttonLabel: 'Next',
    }),
  })

  // Part 2: Recording step — split into groups of ≤6 inputs per screen
  const MAX_INPUTS_PER_SCREEN = 6
  const inputChunks = []
  for (let i = 0; i < textInputs.length; i += MAX_INPUTS_PER_SCREEN) {
    inputChunks.push(textInputs.slice(i, i + MAX_INPUTS_PER_SCREEN))
  }

  const allSteps = [part1]
  const allConns = []
  let prevStep = part1

  for (let i = 0; i < inputChunks.length; i++) {
    const chunk = inputChunks[i]
    const recordTitle =
      inputChunks.length === 1 ? `Record: ${title}` : `Record: ${title} (${i + 1}/${inputChunks.length})`

    const recordingUiParams = buildRecordingUiParams({
      title: recordTitle,
      textInputs: chunk,
    })

    const recordStep = step(`${localId} - Record${inputChunks.length > 1 ? ` ${i + 1}` : ''}`, 'USER_INTERACTION', {
      position: { x: position.x, y: position.y + (i + 1) * DY },
      ui_parameter_specifications: recordingUiParams,
      form_layout_config: buildRecordingLayout({ title: recordTitle, textInputs: chunk }),
      output_parameter_specifications: chunk.map((input) => ({
        id: input.fieldName,
        oid: oid(),
        description: input.label,
      })),
    })

    allSteps.push(recordStep)
    allConns.push(conn(prevStep.oid, recordStep.oid))
    prevStep = recordStep
  }

  return { steps: allSteps, connections: allConns }
}

// ─── Build the Workflow ──────────────────────────────────────────────────────

const steps = []
const connections = []

const CX = 300
const LX = 50
const DY = 250
let row = 0

/**
 * Add an instruction step (possibly auto-split) to the workflow.
 * Returns the last step (to connect the next node from).
 */
function addInstruction(localId, prevStepOid, opts) {
  const result = instructionStep(localId, { x: CX, y: row * DY }, opts)

  // Push all generated steps
  for (const s of result.steps) {
    steps.push(s)
  }

  // Connect first step from previous
  connections.push(conn(prevStepOid, result.steps[0].oid))

  // Push internal connections
  for (const c of result.connections) {
    connections.push(c)
  }

  // Advance row by total steps generated
  row += result.steps.length

  // Return last step for chaining
  return result.steps[result.steps.length - 1]
}

// ══════════════════════════════════════════════════════════════════════════════
// OUTDOOR HEAT PUMP INSPECTION
// ══════════════════════════════════════════════════════════════════════════════

// ── Row 0: START ──
const start = step('Start', 'START', { position: { x: CX, y: row * DY } })
steps.push(start)
row++

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 1: Physical & Environmental Check
// ══════════════════════════════════════════════════════════════════════════════

let prev = addInstruction('Clearance Check', start.oid, {
  title: 'Clearance Inspection',
  image: 'clearance-check.jpg',
  bodyLines: [
    'Verify at least 500mm (20 in) of clearance around all intake grilles.',
    'Measure the clearance on each side of the outdoor unit.',
    'Restricted airflow reduces efficiency and can cause compressor overheating.',
  ],
  tip: 'Mitsubishi City Multi units require unobstructed airflow for proper heat exchange. Check for new obstructions such as vegetation growth or stored equipment.',
  textInputs: [
    { label: 'Front clearance (mm)', placeholder: 'e.g., 650', fieldName: 'clearance_front_mm' },
    { label: 'Rear clearance (mm)', placeholder: 'e.g., 500', fieldName: 'clearance_rear_mm' },
    { label: 'Left clearance (mm)', placeholder: 'e.g., 800', fieldName: 'clearance_left_mm' },
    { label: 'Right clearance (mm)', placeholder: 'e.g., 750', fieldName: 'clearance_right_mm' },
  ],
})

prev = addInstruction('Structure Check', prev.oid, {
  title: 'Structural Integrity',
  image: 'outdoor-unit.jpg',
  bodyLines: [
    'Inspect all mounting bolts for tightness using the appropriate wrench.',
    'Check the concrete or steel base for vibration-induced cracking.',
    'Look for rust or corrosion on mounting hardware.',
    'Verify the unit is level (use a spirit level if available).',
  ],
  tip: 'VRF compressors generate significant vibration. Loose mounting leads to refrigerant line fatigue and premature failure.',
})

prev = addInstruction('Debris Inspection', prev.oid, {
  title: 'Heat Exchanger & Debris',
  image: null,
  bodyLines: [
    'Inspect heat exchanger fins for dust, leaves, or cottonwood buildup.',
    'Check for bent or damaged fins (use a fin comb if needed).',
    'Look inside the unit for animal nests or insect infestations.',
    'Verify the drain holes at the bottom of the unit are clear.',
  ],
  tip: 'A dirty condenser coil can reduce capacity by 20-30%. Schedule a coil cleaning if buildup is moderate or worse.',
  textInputs: [
    { label: 'Debris condition', placeholder: 'Clean / Light / Moderate / Heavy', fieldName: 'debris_condition' },
    { label: 'Notes on debris or damage', placeholder: 'Describe any issues found...', fieldName: 'debris_notes' },
  ],
})

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 2: Electrical & Control Logic
// ══════════════════════════════════════════════════════════════════════════════

prev = addInstruction('Voltage Measurement', prev.oid, {
  title: 'Voltage Symmetry Check',
  image: 'voltage-test.jpg',
  bodyLines: [
    'Measure line-to-line voltage at the outdoor unit disconnect.',
    'Record all three phase-to-phase readings (L1-L2, L2-L3, L1-L3).',
    'Calculate deviation: ((Max - Min) / Average) x 100.',
    'Deviation must be less than 2% for safe compressor operation.',
  ],
  tip: 'Voltage imbalance causes excessive current draw on one phase, leading to winding overheating and premature compressor failure.',
  textInputs: [
    { label: 'L1-L2 Voltage (V)', placeholder: 'e.g., 230', fieldName: 'voltage_l1_l2' },
    { label: 'L2-L3 Voltage (V)', placeholder: 'e.g., 228', fieldName: 'voltage_l2_l3' },
    { label: 'L1-L3 Voltage (V)', placeholder: 'e.g., 231', fieldName: 'voltage_l1_l3' },
    { label: 'Calculated deviation (%)', placeholder: 'e.g., 1.3', fieldName: 'voltage_deviation_pct' },
  ],
})

// ── YES/NO — Voltage Deviation >2%? ──
const voltageDecision = step('Voltage Deviation >2%?', 'YES_NO', {
  position: { x: CX, y: row * DY },
  output_parameter_name: 'voltage_issue',
  ui_parameter_specifications: [
    { oid: oid(), type: 'Header', value: 'Voltage Deviation Check', font_size: 20, align: 'center' },
    { oid: oid(), type: 'Divider', value: '' },
    { oid: oid(), type: 'Text', value: 'Does the calculated voltage deviation exceed 2%?', font_size: 15 },
    {
      oid: oid(),
      type: 'Text',
      value: 'If yes, you must report this power issue to the main office before continuing.',
      font_size: 15,
    },
    { oid: oid(), type: 'YesNoButtons', value: 'Yes, >2%', value2: 'No, Within Spec' },
  ],
  yes_no_config: {
    yes_label: 'Yes, >2%',
    no_label: 'No, Within Spec',
    yes_value: 'true',
    no_value: 'false',
    default_selection: 'none',
  },
  form_layout_config: buildYesNoLayout({
    title: 'Voltage Deviation Check',
    image: null,
    questionLines: [
      'Does the calculated voltage deviation exceed 2%?',
      'If yes, you must report this power issue to the main office before continuing the inspection.',
    ],
    tip: 'Excessive voltage imbalance can damage compressor windings.',
    yesLabel: 'Yes, >2%',
    noLabel: 'No, Within Spec',
  }),
})
steps.push(voltageDecision)
connections.push(conn(prev.oid, voltageDecision.oid))
row++

// ── YES path — Call Main Office ──
const callOfficeResult = instructionStep(
  'Call Main Office',
  { x: LX, y: row * DY },
  {
    title: 'Report Power Issue',
    image: null,
    bodyLines: [
      'Call the main office at 555-1212.',
      'Report the voltage imbalance readings.',
      'Provide the unit serial number and location.',
      'Document the call and any instructions received.',
      'Continue the inspection after reporting.',
    ],
    tip: 'Do not attempt to adjust the power supply. This requires a licensed electrician.',
    textInputs: [
      { label: 'Person contacted', placeholder: 'Name of person at main office', fieldName: 'office_contact_name' },
      { label: 'Instructions received', placeholder: 'Notes from the call...', fieldName: 'office_instructions' },
    ],
  },
)

for (const s of callOfficeResult.steps) steps.push(s)
connections.push(conn(voltageDecision.oid, callOfficeResult.steps[0].oid, { source_handle_id: 'yes' }))
for (const c of callOfficeResult.connections) connections.push(c)
const callOfficeLast = callOfficeResult.steps[callOfficeResult.steps.length - 1]

// ── WAIT ANY — Rejoin after voltage decision ──
row += callOfficeResult.steps.length
const waitAnyVoltage = step('Continue Inspection', 'WAIT ANY', { position: { x: CX, y: row * DY } })
steps.push(waitAnyVoltage)
connections.push(conn(callOfficeLast.oid, waitAnyVoltage.oid))
connections.push(conn(voltageDecision.oid, waitAnyVoltage.oid, { source_handle_id: 'no' }))
row++

prev = addInstruction('Terminal Tightness', waitAnyVoltage.oid, {
  title: 'Terminal & Wiring Check',
  image: 'terminal-check.jpg',
  bodyLines: [
    'Open the electrical compartment cover.',
    'Inspect all wiring for discolored insulation (brown, black, or melted).',
    'Discolored wires indicate overheating — replace immediately.',
    'Torque all terminal screws to manufacturer specification.',
    'Check contactor points for pitting or carbon buildup.',
  ],
  tip: 'Loose terminals cause arcing, which generates heat and accelerates corrosion. Re-torque annually.',
  textInputs: [
    {
      label: 'Discolored wires found?',
      placeholder: 'Yes / No — describe location if Yes',
      fieldName: 'discolored_wires',
    },
  ],
})

prev = addInstruction('Export Error Logs', prev.oid, {
  title: 'M-NET Error Log Export',
  image: 'electrical-panel.jpg',
  bodyLines: [
    'Access the M-NET maintenance controller or laptop tool.',
    'Navigate to Error History / Malfunction Log.',
    'Export or record the last 10 error codes with timestamps.',
    'Note any recurring codes — these indicate chronic issues.',
    'Check for communication errors between indoor and outdoor units.',
  ],
  tip: 'Common VRF error codes: 4102 (high pressure), 4250 (discharge temp), 6607 (inverter). Refer to the Mitsubishi service manual for code definitions.',
  textInputs: [
    { label: 'Error codes (last 10)', placeholder: 'e.g., 4102, 6607, 1302, ...', fieldName: 'error_codes' },
    { label: 'Recurring issues noted', placeholder: 'Describe any patterns...', fieldName: 'error_notes' },
  ],
})

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 3: Refrigerant & Mechanical
// ══════════════════════════════════════════════════════════════════════════════

prev = addInstruction('Oil Leak Inspection', prev.oid, {
  title: 'Compressor Oil Leak Check',
  image: 'compressor-area.jpg',
  bodyLines: [
    'Visually inspect the base of each compressor for oily residue.',
    'Check all flare joints, brazed connections, and service valves.',
    'Look for oil stains on piping, particularly at bends and fittings.',
    'Oily residue indicates a refrigerant leak (oil travels with refrigerant).',
  ],
  tip: 'VRF systems contain large refrigerant charges. Even small leaks lead to significant capacity loss and environmental impact.',
})

// ── YES/NO — Oil Leak Detected? ──
const oilLeakDecision = step('Oil Leak Detected?', 'YES_NO', {
  position: { x: CX, y: row * DY },
  output_parameter_name: 'oil_leak_found',
  ui_parameter_specifications: [
    { oid: oid(), type: 'Header', value: 'Oil Leak Assessment', font_size: 20, align: 'center' },
    { oid: oid(), type: 'Divider', value: '' },
    {
      oid: oid(),
      type: 'Text',
      value: 'Was any oily residue detected at the compressor base, flare joints, or piping connections?',
      font_size: 15,
    },
    { oid: oid(), type: 'Text', value: 'If YES, proceed to the Leak Repair workflow.', font_size: 15 },
    { oid: oid(), type: 'YesNoButtons', value: 'Yes, Leak Found', value2: 'No, All Clear' },
  ],
  yes_no_config: {
    yes_label: 'Yes, Leak Found',
    no_label: 'No, All Clear',
    yes_value: 'true',
    no_value: 'false',
    default_selection: 'none',
  },
  form_layout_config: buildYesNoLayout({
    title: 'Oil Leak Assessment',
    image: null,
    questionLines: [
      'Was any oily residue detected at the compressor base, flare joints, or piping connections?',
      'If YES, proceed to the Leak Repair workflow after documenting the location.',
    ],
    tip: null,
    yesLabel: 'Yes, Leak Found',
    noLabel: 'No, All Clear',
  }),
})
steps.push(oilLeakDecision)
connections.push(conn(prev.oid, oilLeakDecision.oid))
row++

// ── YES path — Leak Repair Instructions ──
const leakRepairResult = instructionStep(
  'Initiate Leak Repair',
  { x: LX, y: row * DY },
  {
    title: 'Leak Repair Required',
    image: null,
    bodyLines: [
      'Document the exact location of the oily residue.',
      'Take a photo of the leak area for the repair team.',
      'Open the "Leak Repair" workflow in Trajectory for the repair procedure.',
      'If the leak is severe, isolate the circuit at the service valve.',
      'Continue this inspection — the repair will be handled separately.',
    ],
    tip: 'SAFETY: Do not use an open flame for leak detection. Use electronic leak detectors or UV dye methods only.',
    textInputs: [
      { label: 'Leak location', placeholder: 'e.g., Compressor #2 suction flare joint', fieldName: 'leak_location' },
      {
        label: 'Severity (Minor / Moderate / Severe)',
        placeholder: 'Describe severity...',
        fieldName: 'leak_severity',
      },
    ],
  },
)

for (const s of leakRepairResult.steps) steps.push(s)
connections.push(conn(oilLeakDecision.oid, leakRepairResult.steps[0].oid, { source_handle_id: 'yes' }))
for (const c of leakRepairResult.connections) connections.push(c)
const leakRepairLast = leakRepairResult.steps[leakRepairResult.steps.length - 1]

// ── WAIT ANY — Rejoin after leak decision ──
row += leakRepairResult.steps.length
const waitAnyLeak = step('Continue After Leak Check', 'WAIT ANY', { position: { x: CX, y: row * DY } })
steps.push(waitAnyLeak)
connections.push(conn(leakRepairLast.oid, waitAnyLeak.oid))
connections.push(conn(oilLeakDecision.oid, waitAnyLeak.oid, { source_handle_id: 'no' }))
row++

prev = addInstruction('Crankcase Heater Check', waitAnyLeak.oid, {
  title: 'Crankcase Heater Verification',
  image: null,
  bodyLines: [
    'Verify the compressor is currently OFF (not running).',
    'Use a clamp ammeter on the crankcase heater circuit.',
    'Confirm current draw matches the nameplate specification.',
    'If no current: check the heater relay, wiring, and heater element.',
  ],
  tip: 'The crankcase heater prevents liquid refrigerant from pooling in the compressor oil sump during off-cycles. A failed heater leads to compressor slugging on startup.',
})

prev = addInstruction('Inverter IPM Check', prev.oid, {
  title: 'Inverter IPM Resistance Check',
  image: null,
  bodyLines: [
    'Disconnect power and wait 5 minutes for capacitors to discharge.',
    'Set multimeter to resistance (ohms) mode.',
    'Measure resistance of the IPM (Intelligent Power Module).',
    'Compare readings to the service manual specifications.',
    'Asymmetric readings indicate a failed power semiconductor.',
  ],
  tip: 'SAFETY: Confirm zero voltage with a meter before touching any inverter components. DC bus capacitors store lethal energy.',
  textInputs: [
    { label: 'IPM resistance reading (ohms)', placeholder: 'e.g., Open / 5.2M / Short', fieldName: 'ipm_resistance' },
    { label: 'Within specification?', placeholder: 'Yes / No', fieldName: 'ipm_in_spec' },
  ],
})

// ══════════════════════════════════════════════════════════════════════════════
// INDOOR UNIT INSPECTION
// ══════════════════════════════════════════════════════════════════════════════

prev = addInstruction('Filter Status', prev.oid, {
  title: 'Indoor Unit: Filter Check',
  image: 'indoor-unit.jpg',
  bodyLines: [
    'Check the "Filter Sign" indicator on the indoor unit remote controller.',
    'Remove and visually inspect the air filters.',
    'If clogged: clean with vacuum or rinse with water and air-dry.',
    'If damaged: replace with correct model filter.',
    'Reset the filter sign timer after cleaning/replacement.',
  ],
  tip: 'Dirty filters are the #1 cause of service calls. They reduce airflow, freeze evaporator coils, and increase energy consumption by up to 15%.',
})

prev = addInstruction('Drain Pan Inspection', prev.oid, {
  title: 'Indoor Unit: Drain Pan',
  image: null,
  bodyLines: [
    'Remove the drain pan access cover.',
    'Inspect for standing water (indicates a blocked drain).',
    'Check for slime, mold, or algae growth.',
    'Clean the pan with a mild disinfectant if contaminated.',
    'Verify the drain line is flowing freely.',
  ],
  tip: 'Biological growth in drain pans can cause health hazards and foul odors. Consider installing condensate pan treatment tablets for prevention.',
})

prev = addInstruction('Condensate Pump Test', prev.oid, {
  title: 'Indoor Unit: Condensate Pump',
  image: null,
  bodyLines: [
    'Locate the secondary drain port on the indoor unit.',
    'Slowly pour approximately 500ml of water into the port.',
    'This should trigger the float switch and activate the pump.',
    'Verify water is pumped out through the condensate line.',
    'Listen for the pump motor — it should run smoothly without grinding.',
  ],
  tip: 'If the float switch does not trigger, the unit will eventually overflow and cause water damage. Test this at every inspection.',
})

// ══════════════════════════════════════════════════════════════════════════════
// SECTION: Operational Metrics
// ══════════════════════════════════════════════════════════════════════════════

prev = addInstruction('Delta T Measurement', prev.oid, {
  title: 'Temperature Differential (ΔT)',
  image: null,
  bodyLines: [
    'Set the unit to COOLING mode at maximum fan speed.',
    'Allow 10 minutes for the system to stabilize.',
    'Measure the Return Air temperature at the intake grille.',
    'Measure the Supply Air temperature at the discharge grille.',
    'Calculate ΔT = Return Air - Supply Air.',
    'Target range: 8°C to 12°C (15°F to 22°F).',
  ],
  tip: 'Low ΔT may indicate low refrigerant charge, dirty evaporator, or restricted airflow. High ΔT may indicate low airflow (dirty filter or failed fan).',
  textInputs: [
    { label: 'Return Air temp (°C)', placeholder: 'e.g., 26.5', fieldName: 'return_air_temp_c' },
    { label: 'Supply Air temp (°C)', placeholder: 'e.g., 16.2', fieldName: 'supply_air_temp_c' },
    { label: 'Delta T (°C)', placeholder: 'e.g., 10.3', fieldName: 'delta_t_c' },
    { label: 'Within target range?', placeholder: 'Yes / No', fieldName: 'delta_t_in_range' },
  ],
})

prev = addInstruction('Vane Motor Check', prev.oid, {
  title: 'Louver / Vane Motor Test',
  image: null,
  bodyLines: [
    'Use the remote controller to cycle the louvers through full range.',
    'Observe horizontal vanes (up/down) through complete travel.',
    'Observe vertical vanes (left/right) through complete travel.',
    'Listen for clicking, grinding, or sticking during movement.',
    'Vanes should move smoothly and return to set position.',
  ],
  tip: 'A sticking vane motor usually indicates a worn gear or bearing. Replace the motor before it fails completely — a stuck louver directs all airflow to one zone.',
})

// ── END ──
const end = step('End', 'END', { position: { x: CX, y: row * DY } })
steps.push(end)
connections.push(conn(prev.oid, end.oid))

// ─── Assemble Workflow ───────────────────────────────────────────────────────

const workflow = {
  local_id: 'VRF Heat Pump Inspection',
  oid: oid(),
  version: '1.0.0',
  last_modified_date: isoNow(),
  description:
    'Outdoor and indoor inspection protocol for Mitsubishi Electric City Multi (VRF) systems. ' +
    'Covers physical/environmental checks, electrical diagnostics, refrigerant/mechanical inspection, ' +
    'and indoor unit operational metrics. Records measurements and routes to repair workflows as needed.',
  schemaVersion: '4.0',
  steps,
  connections,
  viewport: { x: 100, y: 20, zoom: 0.18 },
}

// ─── Package as .WFmasterX ZIP ───────────────────────────────────────────────

async function main() {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })

  const zip = new JSZip()
  zip.file('VRF Heat Pump Inspection.WFmaster', JSON.stringify(workflow, null, 2))

  console.log('Downloading HVAC reference images from Pexels...')
  let imageCount = 0
  for (const [filename, photoId] of Object.entries(PEXELS_IMAGES)) {
    const url = pexelsUrl(photoId)
    try {
      const buf = await downloadImage(url)
      zip.file(`images/${filename}`, buf)
      imageCount++
      console.log(`  [${imageCount}/${Object.keys(PEXELS_IMAGES).length}] ${filename}`)
    } catch (err) {
      console.warn(`  WARN: Could not download ${filename}: ${err.message}`)
    }
  }

  const manifest = {
    workflowName: 'VRF Heat Pump Inspection',
    environmentLibraries: [],
    actionLibraries: [],
    files: [
      { path: 'VRF Heat Pump Inspection.WFmaster', type: 'workflow' },
      ...Object.keys(PEXELS_IMAGES).map((f) => ({ path: `images/${f}`, type: 'image' })),
    ],
  }
  zip.file('manifest.json', JSON.stringify(manifest, null, 2))

  const buf = await zip.generateAsync({ type: 'nodebuffer' })
  const outPath = join(OUT_DIR, 'VRF Heat Pump Inspection.WFmasterX')
  writeFileSync(outPath, buf)

  console.log()
  console.log(`Created: ${outPath}`)
  console.log(`  ${steps.length} steps, ${connections.length} connections, ${imageCount} images`)
  console.log(`  Step types: ${[...new Set(steps.map((s) => s.step_type))].join(', ')}`)

  // Report splits
  const splitSteps = steps.filter((s) => s.local_id.includes(' - Record'))
  if (splitSteps.length > 0) {
    console.log(`  Auto-split steps: ${splitSteps.length} recording screens created`)
    for (const s of splitSteps) {
      console.log(`    → ${s.local_id}`)
    }
  }

  // Count text inputs
  const textInputCount = steps
    .filter((s) => s.output_parameter_specifications && s.output_parameter_specifications.length > 0)
    .reduce((sum, s) => sum + s.output_parameter_specifications.length, 0)
  console.log(`  Text input fields: ${textInputCount}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
