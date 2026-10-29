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
 * Generates a "Lawnmower Inspection & Maintenance" workflow as a .WFmasterX ZIP file
 * importable via the Mission Designer Import Workflow button.
 *
 * Features:
 *   - 4 phases: Safety, Under-Deck, Drive/Control, Cleaning
 *   - PARALLEL branches for Under-Deck and Drive/Control (independent inspections)
 *   - 3 YES_NO decisions: oil change, blade failure, blade sharpening
 *   - 23 text input fields for measurements and observations
 *   - Pexels images for visual context
 *   - Automatic step splitting when content overflows the phone screen
 *
 * Usage: node scripts/generate-lawnmower-inspection.mjs
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const JSZip = require('jszip')

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, '..', 'test-data')

let _oidCounter = 7000000000000
function oid() {
  return String(++_oidCounter)
}
function isoNow() {
  return new Date().toISOString()
}

// ─── Image Download ──────────────────────────────────────────────────────────

const PEXELS_IMAGES = {
  'engine-closeup.jpg': 4162009, // Close-up photo of red lawn mower (engine/deck detail)
  'oil-check.jpg': 5163423, // Person holding black and gray lawn mower (close-up)
  'mower-grass.jpg': 4162016, // Red push mower on green grass (tilt/overview)
  'mower-handle.jpg': 6728919, // Person using mower (shows handle/safety)
  'mower-complete.jpg': 4162011, // Lawn mower on grass (completion shot)
}

function pexelsUrl(photoId) {
  return `https://images.pexels.com/photos/${photoId}/pexels-photo-${photoId}.jpeg?auto=compress&cs=tinysrgb&w=600`
}

async function downloadImage(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

// ─── Layout Height Calculator ────────────────────────────────────────────────

const CONTENT_START_Y = 130
const BUTTON_MAX_Y = 700
const MAX_CONTENT_HEIGHT = BUTTON_MAX_Y - CONTENT_START_Y - 20 // 550px

function calcHeaderHeight() {
  return 46
}
function calcImageHeight() {
  return 210
}
function calcDividerHeight() {
  return 12
}

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

// ─── UI Parameter Builders ───────────────────────────────────────────────────

function buildInstructionUiParams({ title, image, bodyLines, tip, buttonLabel }) {
  return [
    { oid: oid(), type: 'Header', value: title, font_size: 22, align: 'center' },
    ...(image ? [{ oid: oid(), type: 'Image', value: image }] : []),
    { oid: oid(), type: 'Divider', value: '' },
    ...bodyLines.map((line) => ({ oid: oid(), type: 'Text', value: line, font_size: 15 })),
    ...(tip ? [{ oid: oid(), type: 'SmallText', value: tip, font_size: 13, color: '#555555' }] : []),
    { oid: oid(), type: 'Button', value: buttonLabel || 'Done' },
  ]
}

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

// ─── Step & Connection Builders ──────────────────────────────────────────────

function mkStep(localId, stepType, extras = {}) {
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

// ─── Instruction Step with Auto-Split ────────────────────────────────────────

const DY = 250
const MAX_INPUTS_PER_SCREEN = 6

function instructionStep(localId, position, { title, image, bodyLines, tip, textInputs }) {
  const totalHeight = calcTotalHeight({ image, bodyLines, tip, textInputs })

  if (totalHeight <= MAX_CONTENT_HEIGHT || !textInputs || textInputs.length === 0) {
    // Fits on one screen
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

    const s = mkStep(localId, 'USER_INTERACTION', {
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

  // Needs splitting
  const part1 = mkStep(localId, 'USER_INTERACTION', {
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

    const recordStep = mkStep(`${localId} - Record${inputChunks.length > 1 ? ` ${i + 1}` : ''}`, 'USER_INTERACTION', {
      position: { x: position.x, y: position.y + (i + 1) * DY },
      ui_parameter_specifications: buildRecordingUiParams({ title: recordTitle, textInputs: chunk }),
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

const CX = 300 // Center column
const LX = 50 // Left branch (YES paths from main flow)
const B1X = 80 // Under-Deck parallel branch
const B1_LX = -120 // YES sub-branch within Under-Deck
const B2X = 520 // Drive & Control parallel branch
let row = 0

function pos(x, r) {
  return { x, y: r * DY }
}

// ─── Phase 1: Safety & Preparation ──────────────────────────────────────────

// START
const startStep = mkStep('Start', 'START', { position: pos(CX, row) })
steps.push(startStep)
row++

// Spark Plug Disconnect
const sparkResult = instructionStep('Spark Plug Disconnect', pos(CX, row), {
  title: 'Spark Plug Disconnect',
  image: 'engine-closeup.jpg',
  bodyLines: [
    'MANDATORY FIRST STEP: Locate the spark plug',
    'on top of the engine. Pull the rubber boot',
    'firmly off the spark plug terminal to prevent',
    'accidental engine startup during maintenance.',
  ],
  tip: 'Never work under or near the blade without disconnecting the spark plug first.',
})
for (const s of sparkResult.steps) steps.push(s)
for (const c of sparkResult.connections) connections.push(c)
connections.push(conn(startStep.oid, sparkResult.steps[0].oid))
let prevOid = sparkResult.steps[sparkResult.steps.length - 1].oid
row += sparkResult.steps.length

// Fuel Level & Leak Check
const fuelResult = instructionStep('Fuel Level & Leak Check', pos(CX, row), {
  title: 'Fuel Level & Leak Check',
  bodyLines: [
    'Check the fuel level in the tank. Inspect',
    'around the fuel cap, fuel lines, and tank',
    'seams for any signs of leaks, cracks, or',
    'dampness that indicate fuel seepage.',
  ],
  textInputs: [
    { label: 'Fuel Level', placeholder: 'Full / Half / Low / Empty', fieldName: 'fuel_level' },
    { label: 'Leak Observations', placeholder: 'None / Describe location...', fieldName: 'leak_observations' },
  ],
})
for (const s of fuelResult.steps) steps.push(s)
for (const c of fuelResult.connections) connections.push(c)
connections.push(conn(prevOid, fuelResult.steps[0].oid))
prevOid = fuelResult.steps[fuelResult.steps.length - 1].oid
row += fuelResult.steps.length

// Oil Level Check
const oilResult = instructionStep('Oil Level Check', pos(CX, row), {
  title: 'Oil Level Check',
  image: 'oil-check.jpg',
  bodyLines: [
    'Remove the dipstick and wipe it clean with',
    'a rag. Re-insert fully, then withdraw to',
    'check the level. Note the oil color and',
    'level relative to the Add/Full marks.',
  ],
  textInputs: [
    { label: 'Oil Level', placeholder: 'Full / Add / Low', fieldName: 'oil_level' },
    { label: 'Oil Color', placeholder: 'Clear-Amber / Dark / Black', fieldName: 'oil_color' },
  ],
})
for (const s of oilResult.steps) steps.push(s)
for (const c of oilResult.connections) connections.push(c)
connections.push(conn(prevOid, oilResult.steps[0].oid))
prevOid = oilResult.steps[oilResult.steps.length - 1].oid
row += oilResult.steps.length

// YES_NO: Oil Change Needed?
const oilYesNo = mkStep('Oil Change Needed?', 'YES_NO', {
  position: pos(CX, row),
  output_parameter_name: 'oil_change_needed',
  ui_parameter_specifications: [
    { oid: oid(), type: 'Header', value: 'Oil Change Needed?', font_size: 20, align: 'center' },
    { oid: oid(), type: 'Divider', value: '' },
    { oid: oid(), type: 'Text', value: 'Is the oil BLACK in color or below the', font_size: 15 },
    { oid: oid(), type: 'Text', value: '"Add" line on the dipstick?', font_size: 15 },
    {
      oid: oid(),
      type: 'SmallText',
      value: 'Black oil indicates contamination. Low oil risks engine damage.',
      font_size: 13,
      color: '#555555',
    },
    { oid: oid(), type: 'YesNoButtons', value: 'Yes - Change Oil', value2: 'No - Oil OK' },
  ],
  yes_no_config: {
    yes_label: 'Yes - Change Oil',
    no_label: 'No - Oil OK',
    yes_value: 'true',
    no_value: 'false',
    default_selection: 'none',
  },
  form_layout_config: buildYesNoLayout({
    title: 'Oil Change Needed?',
    questionLines: ['Is the oil BLACK in color or below the', '"Add" line on the dipstick?'],
    tip: 'Black oil indicates contamination. Low oil risks engine damage.',
    yesLabel: 'Yes - Change Oil',
    noLabel: 'No - Oil OK',
  }),
})
steps.push(oilYesNo)
connections.push(conn(prevOid, oilYesNo.oid))
row++

// YES path: Change Oil Task
const changeOilResult = instructionStep('Change Oil', pos(LX, row), {
  title: 'Change Oil',
  bodyLines: [
    'Oil change required. Drain old oil per the',
    'manufacturer instructions. Replace with the',
    'recommended oil grade and quantity. Dispose',
    'of used oil at a recycling center.',
  ],
  tip: "Check your owner's manual for the correct oil type (typically SAE 30 or 10W-30).",
  textInputs: [
    { label: 'Oil Type Used', placeholder: 'e.g., SAE 30, 10W-30...', fieldName: 'oil_type_used' },
    { label: 'Quantity Added', placeholder: 'e.g., 20 oz, 0.6L...', fieldName: 'oil_quantity' },
  ],
})
for (const s of changeOilResult.steps) steps.push(s)
for (const c of changeOilResult.connections) connections.push(c)
connections.push(conn(oilYesNo.oid, changeOilResult.steps[0].oid, { source_handle_id: 'yes' }))
const changeOilLastOid = changeOilResult.steps[changeOilResult.steps.length - 1].oid
row += changeOilResult.steps.length

// WAIT ANY (oil rejoin)
const oilWaitAny = mkStep('Continue After Oil Check', 'WAIT ANY', { position: pos(CX, row) })
steps.push(oilWaitAny)
connections.push(conn(oilYesNo.oid, oilWaitAny.oid, { source_handle_id: 'no' }))
connections.push(conn(changeOilLastOid, oilWaitAny.oid))
row++

// ─── PARALLEL Fork ───────────────────────────────────────────────────────────

const parallelStep = mkStep('Begin Inspection', 'PARALLEL', { position: pos(CX, row) })
steps.push(parallelStep)
connections.push(conn(oilWaitAny.oid, parallelStep.oid))
row++

const branchStartRow = row

// ─── Branch 1: Under-Deck Inspection (B1X) ──────────────────────────────────

let b1Row = branchStartRow

// Tilt Mower Safety Note
const tiltStep = mkStep('Tilt Mower - Safety', 'USER_INTERACTION', {
  position: pos(B1X, b1Row),
  ui_parameter_specifications: buildInstructionUiParams({
    title: 'Tilt Mower - Safety',
    image: 'mower-grass.jpg',
    bodyLines: [
      'IMPORTANT: Always tilt the mower with',
      'the air filter facing UP. This prevents',
      'oil from flooding the carburetor.',
      'Carefully tilt the mower onto its side.',
    ],
    tip: 'Air filter UP, exhaust DOWN. Place on a clean surface.',
  }),
  form_layout_config: buildInstructionLayout({
    title: 'Tilt Mower - Safety',
    image: 'mower-grass.jpg',
    bodyLines: [
      'IMPORTANT: Always tilt the mower with',
      'the air filter facing UP. This prevents',
      'oil from flooding the carburetor.',
      'Carefully tilt the mower onto its side.',
    ],
    tip: 'Air filter UP, exhaust DOWN. Place on a clean surface.',
  }),
})
steps.push(tiltStep)
connections.push(conn(parallelStep.oid, tiltStep.oid))
b1Row++

// Blade Condition Check
const bladeCondResult = instructionStep('Blade Condition Check', pos(B1X, b1Row), {
  title: 'Blade Condition',
  bodyLines: [
    'Inspect the blade for nicks, cracks, bends,',
    'or excessive dullness. Look at the cutting',
    'edge along the full length. Check the center',
    'mounting hole for elongation or damage.',
  ],
  textInputs: [
    { label: 'Blade Condition Notes', placeholder: 'Describe condition...', fieldName: 'blade_condition_notes' },
  ],
})
for (const s of bladeCondResult.steps) steps.push(s)
for (const c of bladeCondResult.connections) connections.push(c)
connections.push(conn(tiltStep.oid, bladeCondResult.steps[0].oid))
let b1Prev = bladeCondResult.steps[bladeCondResult.steps.length - 1].oid
b1Row += bladeCondResult.steps.length

// YES_NO: Blade Failed?
const bladeYesNo = mkStep('Blade Replacement Needed?', 'YES_NO', {
  position: pos(B1X, b1Row),
  output_parameter_name: 'blade_failed',
  ui_parameter_specifications: [
    { oid: oid(), type: 'Header', value: 'Blade Replacement?', font_size: 20, align: 'center' },
    { oid: oid(), type: 'Divider', value: '' },
    { oid: oid(), type: 'Text', value: 'Is the blade bent, cracked, or showing', font_size: 15 },
    { oid: oid(), type: 'Text', value: 'visible damage requiring replacement?', font_size: 15 },
    { oid: oid(), type: 'YesNoButtons', value: 'Yes - Failed', value2: 'No - OK' },
  ],
  yes_no_config: {
    yes_label: 'Yes - Failed',
    no_label: 'No - OK',
    yes_value: 'true',
    no_value: 'false',
    default_selection: 'none',
  },
  form_layout_config: buildYesNoLayout({
    title: 'Blade Replacement?',
    questionLines: ['Is the blade bent, cracked, or showing', 'visible damage requiring replacement?'],
    tip: 'A bent blade is unsafe. Never attempt to straighten a bent blade.',
    yesLabel: 'Yes - Failed',
    noLabel: 'No - OK',
  }),
})
steps.push(bladeYesNo)
connections.push(conn(b1Prev, bladeYesNo.oid))
b1Row++

// YES: Mark Failed
const markFailed = mkStep('FAILED - Replace Blade', 'USER_INTERACTION', {
  position: pos(B1_LX, b1Row),
  ui_parameter_specifications: [
    ...buildInstructionUiParams({
      title: 'FAILED - Replace Blade',
      bodyLines: [
        'The blade has FAILED inspection and must',
        'be replaced before next use. Do NOT attempt',
        'to straighten a bent blade. Order a matching',
        'replacement from the manufacturer.',
      ],
    }).slice(0, -1), // remove Button
    { oid: oid(), type: 'Text', value: 'Failure Description', font_size: 14 },
    { oid: oid(), type: 'TextInput', value: 'Describe the failure...', lines: 1 },
    { oid: oid(), type: 'Button', value: 'Done' },
  ],
  form_layout_config: buildCombinedLayout({
    title: 'FAILED - Replace Blade',
    bodyLines: [
      'The blade has FAILED inspection and must',
      'be replaced before next use. Do NOT attempt',
      'to straighten a bent blade. Order a matching',
      'replacement from the manufacturer.',
    ],
    textInputs: [
      { label: 'Failure Description', placeholder: 'Describe the failure...', fieldName: 'blade_failure_notes' },
    ],
  }),
  output_parameter_specifications: [{ id: 'blade_failure_notes', oid: oid(), description: 'Failure Description' }],
})
steps.push(markFailed)
connections.push(conn(bladeYesNo.oid, markFailed.oid, { source_handle_id: 'yes' }))
b1Row++

// WAIT ANY (blade rejoin)
const bladeWaitAny = mkStep('Continue Blade Inspection', 'WAIT ANY', { position: pos(B1X, b1Row) })
steps.push(bladeWaitAny)
connections.push(conn(bladeYesNo.oid, bladeWaitAny.oid, { source_handle_id: 'no' }))
connections.push(conn(markFailed.oid, bladeWaitAny.oid))
b1Row++

// Blade Sharpness Rating
const sharpResult = instructionStep('Blade Sharpness Rating', pos(B1X, b1Row), {
  title: 'Blade Sharpness',
  bodyLines: [
    'Rate the blade sharpness on a scale of 1-5:',
    '1 = Very dull, rounded edge',
    '2 = Dull, tears grass instead of cutting',
    '3 = Acceptable, reasonably clean cut',
    '4 = Good, sharp cutting edge',
    '5 = Like new, razor sharp',
  ],
  textInputs: [{ label: 'Sharpness Rating (1-5)', placeholder: 'Enter 1 through 5', fieldName: 'sharpness_rating' }],
})
for (const s of sharpResult.steps) steps.push(s)
for (const c of sharpResult.connections) connections.push(c)
connections.push(conn(bladeWaitAny.oid, sharpResult.steps[0].oid))
b1Prev = sharpResult.steps[sharpResult.steps.length - 1].oid
b1Row += sharpResult.steps.length

// YES_NO: Needs Sharpening?
const sharpYesNo = mkStep('Sharpening Needed?', 'YES_NO', {
  position: pos(B1X, b1Row),
  output_parameter_name: 'needs_sharpening',
  ui_parameter_specifications: [
    { oid: oid(), type: 'Header', value: 'Sharpening Needed?', font_size: 20, align: 'center' },
    { oid: oid(), type: 'Divider', value: '' },
    { oid: oid(), type: 'Text', value: 'Is the sharpness rating below 3?', font_size: 15 },
    { oid: oid(), type: 'Text', value: 'A rating below 3 means the blade tears', font_size: 15 },
    { oid: oid(), type: 'Text', value: 'grass and needs sharpening.', font_size: 15 },
    { oid: oid(), type: 'YesNoButtons', value: 'Yes - Sharpen', value2: 'No - OK' },
  ],
  yes_no_config: {
    yes_label: 'Yes - Sharpen',
    no_label: 'No - OK',
    yes_value: 'true',
    no_value: 'false',
    default_selection: 'none',
  },
  form_layout_config: buildYesNoLayout({
    title: 'Sharpening Needed?',
    questionLines: [
      'Is the sharpness rating below 3?',
      'A rating below 3 means the blade tears',
      'grass and needs sharpening.',
    ],
    yesLabel: 'Yes - Sharpen',
    noLabel: 'No - OK',
  }),
})
steps.push(sharpYesNo)
connections.push(conn(b1Prev, sharpYesNo.oid))
b1Row++

// YES: Schedule Sharpening
const sharpenStep = mkStep('Sharpen Blade', 'USER_INTERACTION', {
  position: pos(B1_LX, b1Row),
  ui_parameter_specifications: [
    ...buildInstructionUiParams({
      title: 'Sharpen Blade',
      bodyLines: [
        'Remove the blade using the correct socket.',
        'Sharpen using a bench grinder or mill file',
        'at the original bevel angle. Maintain equal',
        'material removal from each end for balance.',
      ],
    }).slice(0, -1),
    { oid: oid(), type: 'Text', value: 'Sharpening Notes', font_size: 14 },
    { oid: oid(), type: 'TextInput', value: 'Describe work done...', lines: 1 },
    { oid: oid(), type: 'Button', value: 'Done' },
  ],
  form_layout_config: buildCombinedLayout({
    title: 'Sharpen Blade',
    bodyLines: [
      'Remove the blade using the correct socket.',
      'Sharpen using a bench grinder or mill file',
      'at the original bevel angle. Maintain equal',
      'material removal from each end for balance.',
    ],
    textInputs: [{ label: 'Sharpening Notes', placeholder: 'Describe work done...', fieldName: 'sharpening_notes' }],
  }),
  output_parameter_specifications: [{ id: 'sharpening_notes', oid: oid(), description: 'Sharpening Notes' }],
})
steps.push(sharpenStep)
connections.push(conn(sharpYesNo.oid, sharpenStep.oid, { source_handle_id: 'yes' }))
b1Row++

// WAIT ANY (sharpness rejoin)
const sharpWaitAny = mkStep('Continue After Sharpness', 'WAIT ANY', { position: pos(B1X, b1Row) })
steps.push(sharpWaitAny)
connections.push(conn(sharpYesNo.oid, sharpWaitAny.oid, { source_handle_id: 'no' }))
connections.push(conn(sharpenStep.oid, sharpWaitAny.oid))
b1Row++

// Blade Balance
const balanceResult = instructionStep('Blade Balance Check', pos(B1X, b1Row), {
  title: 'Blade Balance',
  bodyLines: [
    'Check that the blade spins freely and evenly',
    'on the mounting bolt. It should not wobble or',
    'sit at an angle. An unbalanced blade causes',
    'vibration and premature bearing wear.',
  ],
  textInputs: [
    { label: 'Balance Status', placeholder: 'OK / Wobble / Needs Adjustment', fieldName: 'blade_balance_status' },
  ],
})
for (const s of balanceResult.steps) steps.push(s)
for (const c of balanceResult.connections) connections.push(c)
connections.push(conn(sharpWaitAny.oid, balanceResult.steps[0].oid))
b1Prev = balanceResult.steps[balanceResult.steps.length - 1].oid
b1Row += balanceResult.steps.length

// Debris Build-up
const debrisResult = instructionStep('Debris Build-up', pos(B1X, b1Row), {
  title: 'Debris Build-up',
  bodyLines: [
    'Inspect the cutting envelope under the deck',
    'for dried grass build-up. Heavy clogging',
    'restricts airflow and reduces cutting quality.',
    'Scrape away compacted grass with a plastic',
    'putty knife to avoid scratching the deck.',
  ],
  textInputs: [
    { label: 'Debris Level', placeholder: 'None / Light / Heavy', fieldName: 'debris_level' },
    { label: 'Action Taken', placeholder: 'Scraped clean / Partial / N/A', fieldName: 'debris_action' },
  ],
})
for (const s of debrisResult.steps) steps.push(s)
for (const c of debrisResult.connections) connections.push(c)
connections.push(conn(b1Prev, debrisResult.steps[0].oid))
const b1LastOid = debrisResult.steps[debrisResult.steps.length - 1].oid
b1Row += debrisResult.steps.length

// ─── Branch 2: Drive & Control System (B2X) ─────────────────────────────────

let b2Row = branchStartRow

// Safety Bail Arm
const bailResult = instructionStep('Safety Bail Arm', pos(B2X, b2Row), {
  title: 'Safety Bail Arm',
  image: 'mower-handle.jpg',
  bodyLines: [
    'Pull the safety bail arm handle toward the',
    'mower handle. The engine brake should release',
    'smoothly. When released, the blade should',
    'stop within 3 seconds.',
  ],
  textInputs: [
    { label: 'Bail Arm Condition', placeholder: 'Smooth / Stiff / Stuck', fieldName: 'bail_arm_condition' },
    { label: 'Brake Engages Properly?', placeholder: 'Yes / No', fieldName: 'brake_release' },
  ],
})
for (const s of bailResult.steps) steps.push(s)
for (const c of bailResult.connections) connections.push(c)
connections.push(conn(parallelStep.oid, bailResult.steps[0].oid))
let b2Prev = bailResult.steps[bailResult.steps.length - 1].oid
b2Row += bailResult.steps.length

// Drive Cable Check
const driveResult = instructionStep('Drive Cable Check', pos(B2X, b2Row), {
  title: 'Drive Cable Check',
  bodyLines: [
    'For self-propelled models: Check the drive',
    'cable for proper tension. With the drive lever',
    'released, the mower should NOT creep forward.',
    'If it does, the cable needs adjustment.',
  ],
  tip: 'Skip this step if your mower is push-type only.',
  textInputs: [
    { label: 'Cable Tension', placeholder: 'OK / Slack / Too Tight', fieldName: 'drive_cable_tension' },
    { label: 'Mower Creeps When Released?', placeholder: 'Yes / No / N/A (push mower)', fieldName: 'creep_test' },
  ],
})
for (const s of driveResult.steps) steps.push(s)
for (const c of driveResult.connections) connections.push(c)
connections.push(conn(b2Prev, driveResult.steps[0].oid))
b2Prev = driveResult.steps[driveResult.steps.length - 1].oid
b2Row += driveResult.steps.length

// Wheel Bearings
const wheelResult = instructionStep('Wheel Bearings Check', pos(B2X, b2Row), {
  title: 'Wheel Bearings',
  bodyLines: [
    'Wiggle each wheel side to side. Check for',
    'excessive lateral play indicating worn bushings.',
    'Spin each wheel to check for grinding or',
    'rough rotation.',
  ],
  textInputs: [
    { label: 'Front Left Wheel', placeholder: 'OK / Play / Grinding', fieldName: 'wheel_front_left' },
    { label: 'Front Right Wheel', placeholder: 'OK / Play / Grinding', fieldName: 'wheel_front_right' },
    { label: 'Rear Left Wheel', placeholder: 'OK / Play / Grinding', fieldName: 'wheel_rear_left' },
    { label: 'Rear Right Wheel', placeholder: 'OK / Play / Grinding', fieldName: 'wheel_rear_right' },
  ],
})
for (const s of wheelResult.steps) steps.push(s)
for (const c of wheelResult.connections) connections.push(c)
connections.push(conn(b2Prev, wheelResult.steps[0].oid))
const b2LastOid = wheelResult.steps[wheelResult.steps.length - 1].oid
b2Row += wheelResult.steps.length

// ─── WAIT_ALL (join parallel branches) ───────────────────────────────────────

row = Math.max(b1Row, b2Row)

const waitAll = mkStep('Inspection Complete', 'WAIT ALL', { position: pos(CX, row) })
steps.push(waitAll)
connections.push(conn(b1LastOid, waitAll.oid))
connections.push(conn(b2LastOid, waitAll.oid))
row++

// ─── Phase 4: Cleaning Protocol ──────────────────────────────────────────────

// Air Filter Inspection
prevOid = waitAll.oid
const airFilterResult = instructionStep('Air Filter Inspection', pos(CX, row), {
  title: 'Air Filter Inspection',
  bodyLines: [
    'Remove the air filter cover. Remove the',
    'filter element. Inspect the filter condition',
    'and identify the filter type.',
  ],
  textInputs: [
    { label: 'Filter Condition', placeholder: 'New / Clean / Dirty / Damaged', fieldName: 'filter_condition' },
    { label: 'Filter Type', placeholder: 'Paper / Foam', fieldName: 'filter_type' },
  ],
})
for (const s of airFilterResult.steps) steps.push(s)
for (const c of airFilterResult.connections) connections.push(c)
connections.push(conn(prevOid, airFilterResult.steps[0].oid))
prevOid = airFilterResult.steps[airFilterResult.steps.length - 1].oid
row += airFilterResult.steps.length

// Air Filter Maintenance
const airMaintResult = instructionStep('Air Filter Maintenance', pos(CX, row), {
  title: 'Air Filter Maintenance',
  bodyLines: [
    'Based on filter type:',
    '- Paper: Tap gently to dislodge dust. Do NOT',
    '  wash or oil a paper filter. Replace if soiled.',
    '- Foam: Check for oil saturation. Wash in warm',
    '  soapy water, squeeze dry, re-oil if required.',
  ],
  textInputs: [{ label: 'Action Taken', placeholder: 'Cleaned / Replaced / OK as-is', fieldName: 'filter_action' }],
})
for (const s of airMaintResult.steps) steps.push(s)
for (const c of airMaintResult.connections) connections.push(c)
connections.push(conn(prevOid, airMaintResult.steps[0].oid))
prevOid = airMaintResult.steps[airMaintResult.steps.length - 1].oid
row += airMaintResult.steps.length

// Cooling Fins
const finsResult = instructionStep('Cooling Fins Cleaning', pos(CX, row), {
  title: 'Cooling Fins Cleaning',
  bodyLines: [
    'Use compressed air or a stiff brush to clean',
    'the cooling fins around the engine head.',
    'Remove all grass clippings, dirt, and debris.',
    'Clogged fins cause engine overheating.',
  ],
  tip: 'Wear safety glasses when using compressed air.',
  textInputs: [
    { label: 'Fins Condition Before', placeholder: 'Clean / Light Debris / Heavy Debris', fieldName: 'fins_condition' },
    { label: 'Cleaned Successfully?', placeholder: 'Yes / No', fieldName: 'fins_cleaned' },
  ],
})
for (const s of finsResult.steps) steps.push(s)
for (const c of finsResult.connections) connections.push(c)
connections.push(conn(prevOid, finsResult.steps[0].oid))
prevOid = finsResult.steps[finsResult.steps.length - 1].oid
row += finsResult.steps.length

// Deck Wash & Scrape
const deckResult = instructionStep('Deck Wash & Scrape', pos(CX, row), {
  title: 'Deck Wash & Scrape',
  bodyLines: [
    'Scrape away "grass scale" from the underside',
    'of the deck. Use a plastic putty knife to',
    'avoid scratching the metal or paint coating.',
  ],
  tip: 'Some mowers have a deck wash port - connect a garden hose and run the blade briefly to rinse.',
  textInputs: [
    { label: 'Deck Condition', placeholder: 'Clean / Light Build-up / Heavy Scale', fieldName: 'deck_condition' },
    { label: 'Action Taken', placeholder: 'Scraped / Hose wash / N/A', fieldName: 'deck_action' },
  ],
})
for (const s of deckResult.steps) steps.push(s)
for (const c of deckResult.connections) connections.push(c)
connections.push(conn(prevOid, deckResult.steps[0].oid))
prevOid = deckResult.steps[deckResult.steps.length - 1].oid
row += deckResult.steps.length

// Reconnect Spark Plug
const reconnectResult = instructionStep('Reconnect Spark Plug', pos(CX, row), {
  title: 'Reconnect Spark Plug',
  image: 'mower-complete.jpg',
  bodyLines: [
    'Maintenance complete. Return the mower to',
    'its upright position. Reconnect the spark',
    'plug lead by firmly pushing the rubber boot',
    'back onto the spark plug terminal until it',
    'clicks into place.',
  ],
})
for (const s of reconnectResult.steps) steps.push(s)
for (const c of reconnectResult.connections) connections.push(c)
connections.push(conn(prevOid, reconnectResult.steps[0].oid))
prevOid = reconnectResult.steps[reconnectResult.steps.length - 1].oid
row += reconnectResult.steps.length

// END
const endStep = mkStep('End', 'END', { position: pos(CX, row) })
steps.push(endStep)
connections.push(conn(prevOid, endStep.oid))

// ─── Package as ZIP ──────────────────────────────────────────────────────────

async function main() {
  const zip = new JSZip()
  const WORKFLOW_NAME = 'Lawnmower Inspection & Maintenance'

  // Download images
  const imageBuffers = {}
  for (const [filename, photoId] of Object.entries(PEXELS_IMAGES)) {
    console.log(`Downloading ${filename}...`)
    try {
      imageBuffers[filename] = await downloadImage(pexelsUrl(photoId))
    } catch (err) {
      console.warn(`  Warning: Failed to download ${filename}: ${err.message}`)
    }
  }

  // Add images to ZIP
  for (const [filename, buffer] of Object.entries(imageBuffers)) {
    zip.file(`images/${filename}`, buffer)
  }

  // Build manifest
  const manifest = {
    workflowName: WORKFLOW_NAME,
    environmentLibraries: [],
    actionLibraries: [],
    files: [
      { path: `${WORKFLOW_NAME}.WFmaster`, type: 'workflow' },
      ...Object.keys(imageBuffers).map((f) => ({ path: `images/${f}`, type: 'image' })),
    ],
  }
  zip.file('manifest.json', JSON.stringify(manifest, null, 2))

  // Build workflow JSON
  const workflow = {
    schemaVersion: '4.0',
    local_id: WORKFLOW_NAME,
    oid: oid(),
    version: '1.0.0',
    last_modified_date: isoNow(),
    description:
      'Complete lawnmower inspection and maintenance workflow covering safety disconnect, fuel/oil checks, under-deck blade inspection, drive system checks, and cleaning protocol.',
    steps,
    connections,
    viewport: { x: 100, y: 20, zoom: 0.15 },
  }
  zip.file(`${WORKFLOW_NAME}.WFmaster`, JSON.stringify(workflow, null, 2))

  // Write ZIP
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })
  const outPath = join(OUT_DIR, `${WORKFLOW_NAME}.WFmasterX`)
  const buffer = await zip.generateAsync({ type: 'nodebuffer' })
  writeFileSync(outPath, buffer)

  // Summary
  const inputCount = steps.reduce((n, s) => n + (s.output_parameter_specifications?.length || 0), 0)
  console.log(`\nWritten: ${outPath}`)
  console.log(
    `Steps: ${steps.length}, Connections: ${connections.length}, Text Inputs: ${inputCount}, Images: ${Object.keys(imageBuffers).length}`,
  )
  console.log(`Step types: ${[...new Set(steps.map((s) => s.step_type))].join(', ')}`)
}

main().catch(console.error)
