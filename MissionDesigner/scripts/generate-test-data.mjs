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
 * Mission Designer - Comprehensive Test Data Generator
 *
 * Generates 35 importable files conforming to Mission Designer schemas:
 *   20 action libraries  (.WFaction  — plain JSON)
 *    8 environment libs   (.WFenvir  — plain JSON)
 *    3 step libraries     (.WFslibX  — plain JSON)
 *    4 workflow libraries (.WFlibX   — ZIP packages)
 *
 * Usage: node scripts/generate-test-data.mjs
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const JSZip = require('jszip')

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, '..', 'test-data')

// ─── Seeded PRNG (deterministic output) ───────────────────────────────────────
let _seed = 42
function rand() {
  _seed = (_seed * 1103515245 + 12345) & 0x7fffffff
  return _seed / 0x7fffffff
}
function randInt(min, max) {
  return Math.floor(rand() * (max - min + 1)) + min
}
function pick(arr) {
  return arr[randInt(0, arr.length - 1)]
}
function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(0, i)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ─── OID generation (monotonic snowflake-like) ────────────────────────────────
let _oidCounter = 1000000000000
function oid() {
  return String(++_oidCounter)
}

// ─── ISO timestamp ────────────────────────────────────────────────────────────
function isoDate() {
  const d = new Date(2026, randInt(0, 1), randInt(1, 28), randInt(0, 23), randInt(0, 59))
  return d.toISOString()
}

// ─── Managed element base ─────────────────────────────────────────────────────
function managedElement(localId, extra = {}) {
  return {
    local_id: localId,
    oid: oid(),
    version: `${randInt(1, 3)}.${randInt(0, 9)}.${randInt(0, 9)}`,
    last_modified_date: isoDate(),
    ...extra,
  }
}

// ─── Naming data ──────────────────────────────────────────────────────────────
const ACTION_LIB_THEMES = [
  'Conveyor Control',
  'Temperature Management',
  'Pressure Control',
  'Flow Regulation',
  'Level Monitoring',
  'Valve Operations',
  'Motor Control',
  'Pump Management',
  'Heating Systems',
  'Cooling Systems',
  'Mixing Operations',
  'Filtration Control',
  'Weighing Systems',
  'Dosing Control',
  'Packaging Operations',
  'Labeling Systems',
  'Inspection Control',
  'Quality Checks',
  'CIP Cleaning',
  'Safety Interlocks',
]

const ENV_LIB_THEMES = [
  ['Mixing Unit', 'Blending Station'],
  ['Reactor Vessel', 'Heat Exchanger', 'Condenser'],
  ['Filling Line', 'Capping Station'],
  ['Packaging Cell', 'Palletizer', 'Wrapper'],
  ['CIP Skid', 'Rinse Station'],
  ['Fermentation Tank', 'Aeration Unit', 'pH Control'],
  ['Distillation Column', 'Reboiler'],
  ['Granulator', 'Dryer', 'Sieve'],
]

const WORKFLOW_LIB_THEMES = ['Batch Production', 'Continuous Processing', 'Quality Assurance', 'Maintenance Operations']

const WORKFLOW_NAMES = [
  // Batch Production
  [
    'Batch Mixing',
    'Batch Heating',
    'Batch Cooling',
    'Batch Transfer',
    'Batch Agitation',
    'Batch Sampling',
    'Batch Hold',
    'Batch Discharge',
  ],
  // Continuous Processing
  [
    'Feed Preparation',
    'Reaction Phase',
    'Separation Step',
    'Product Recovery',
    'Waste Treatment',
    'Recycle Loop',
    'Buffer Storage',
    'Final Polishing',
  ],
  // Quality Assurance
  [
    'Incoming Inspection',
    'In-Process Check',
    'Final QC Test',
    'Stability Study',
    'Calibration Run',
    'Deviation Investigation',
    'CAPA Execution',
    'Release Testing',
  ],
  // Maintenance Operations
  [
    'Preventive Maintenance',
    'Corrective Repair',
    'Equipment Calibration',
    'Lubrication Routine',
    'Filter Replacement',
    'Belt Tensioning',
    'Vibration Analysis',
    'Alignment Check',
  ],
]

const STEP_LIB_THEMES = ['Common Process Steps', 'Operator Interaction Steps', 'Decision and Control Steps']

const ACTION_VERBS = [
  'Start',
  'Stop',
  'Set',
  'Get',
  'Read',
  'Write',
  'Open',
  'Close',
  'Enable',
  'Disable',
  'Reset',
  'Initialize',
  'Configure',
  'Monitor',
  'Adjust',
  'Calibrate',
  'Flush',
  'Drain',
  'Fill',
  'Transfer',
  'Heat',
  'Cool',
  'Mix',
  'Agitate',
  'Filter',
  'Weigh',
  'Dose',
  'Inspect',
  'Label',
  'Package',
  'Seal',
  'Test',
  'Validate',
  'Purge',
]

const ACTION_NOUNS = [
  'Speed',
  'Temperature',
  'Pressure',
  'Flow',
  'Level',
  'Position',
  'Valve',
  'Motor',
  'Pump',
  'Heater',
  'Cooler',
  'Mixer',
  'Agitator',
  'Sensor',
  'Controller',
  'Actuator',
  'Conveyor',
  'Belt',
  'Hopper',
  'Tank',
  'Vessel',
  'Pipe',
  'Nozzle',
  'Gauge',
  'Switch',
  'Alarm',
]

const PARAM_NAMES = [
  'Setpoint',
  'Duration',
  'Rate',
  'Threshold',
  'Mode',
  'Target',
  'Tolerance',
  'Delay',
  'Interval',
  'Timeout',
  'Offset',
  'Gain',
  'Limit',
  'Factor',
  'Ratio',
  'Count',
  'Index',
  'Address',
  'Tag',
]

const OUTPUT_NAMES = [
  'CurrentValue',
  'Status',
  'Result',
  'ErrorCode',
  'Measurement',
  'Position',
  'Reading',
  'State',
  'Quality',
  'Timestamp',
  'Delta',
  'Average',
  'Maximum',
  'Minimum',
  'Variance',
  'FinalValue',
]

const RESOURCE_NAMES = [
  'Reactor',
  'Mixer',
  'Conveyor',
  'Pump',
  'Valve',
  'Tank',
  'Heater',
  'Cooler',
  'Sensor',
  'Controller',
  'Scale',
  'Press',
  'Centrifuge',
  'Dryer',
  'Chiller',
  'Boiler',
]

const POOL_NAMES_MAP = {
  Reactor: ['Reactor-A', 'Reactor-B', 'Reactor-C'],
  Mixer: ['Mixer-1', 'Mixer-2'],
  Tank: ['Tank-North', 'Tank-South', 'Tank-East'],
  Pump: ['Pump-P01', 'Pump-P02', 'Pump-P03', 'Pump-P04'],
  Sensor: ['Sensor-TT01', 'Sensor-TT02', 'Sensor-PT01'],
}

const VALUE_PROP_NAMES = [
  'BatchID',
  'ProductCode',
  'TargetWeight',
  'MeasuredTemp',
  'OperatorName',
  'LotNumber',
  'RecipeVersion',
  'StepResult',
  'TotalVolume',
  'ElapsedTime',
  'PressureReading',
  'FlowRate',
]

const RESOURCE_TYPES = [
  'binary exclusive use',
  'binary shared use with pool limits',
  'countable use with pool limits',
  'named pool',
]

// ─── Helpers ──────────────────────────────────────────────────────────────────
function inputParam() {
  return {
    id: pick(PARAM_NAMES) + '_' + randInt(1, 999),
    oid: oid(),
    description: `Parameter for ${pick(ACTION_NOUNS).toLowerCase()} control`,
    default_value: String(randInt(0, 1000)),
    value_type: pick(['literal', 'property']),
  }
}

function outputParam() {
  return {
    id: pick(OUTPUT_NAMES) + '_' + randInt(1, 999),
    oid: oid(),
    description: `Output from ${pick(ACTION_NOUNS).toLowerCase()} reading`,
    target: rand() > 0.5 ? pick(VALUE_PROP_NAMES) : undefined,
  }
}

function valuePropSpec() {
  return {
    name: pick(VALUE_PROP_NAMES) + '_' + randInt(1, 99),
    oid: oid(),
    entries: [
      { name: 'initial', value: String(randInt(0, 100)) },
      { name: 'unit', value: pick(['kg', 'L', 'C', 'bar', 'rpm', 'mm', 's']) },
    ],
  }
}

function resourcePropSpec(forceType) {
  const rt = forceType || pick(RESOURCE_TYPES)
  const name = pick(RESOURCE_NAMES) + '_' + randInt(1, 99)
  const spec = { name, resource_type: rt, description: `${rt} resource` }
  if (rt === 'binary shared use with pool limits') spec.use_limit = randInt(2, 5)
  if (rt === 'countable use with pool limits') spec.use_limit = randInt(5, 20)
  if (rt === 'named pool') {
    const base = Object.keys(POOL_NAMES_MAP).find((k) => name.startsWith(k))
    spec.names = base ? POOL_NAMES_MAP[base] : [`${name}-A`, `${name}-B`, `${name}-C`]
  }
  return spec
}

// ─── Action Library Generation ────────────────────────────────────────────────
/** @type {Array<{libName: string, libData: object, actions: Array<{local_id: string, oid: string}>}>} */
const generatedActionLibs = []

function generateActionLibrary(index) {
  const theme = ACTION_LIB_THEMES[index]
  const slug = theme.toLowerCase().replace(/\s+/g, '-')
  const numActions = randInt(10, 30)
  const actions = []

  for (let i = 0; i < numActions; i++) {
    const verb = pick(ACTION_VERBS)
    const noun = pick(ACTION_NOUNS)
    const actionName = `${verb} ${noun}`
    const numInputs = randInt(1, 5)
    const numOutputs = randInt(1, 6)

    actions.push({
      ...managedElement(actionName),
      input_parameter_specifications: Array.from({ length: numInputs }, inputParam),
      output_parameter_specifications: Array.from({ length: numOutputs }, outputParam),
      action_visibility: pick(['opaque', 'observable']),
      ...(rand() > 0.6
        ? {
            property_specifications: [
              {
                name: `${noun}Config`,
                oid: oid(),
                entries: [
                  { name: 'mode', value: pick(['auto', 'manual', 'semi-auto']) },
                  { name: 'priority', value: String(randInt(1, 10)) },
                ],
              },
            ],
          }
        : {}),
    })
  }

  const lib = {
    ...managedElement(theme),
    description: `Action library for ${theme.toLowerCase()} operations in manufacturing environments.`,
    action_specifications: actions,
  }

  generatedActionLibs.push({
    libName: theme,
    libData: lib,
    actions: actions.map((a) => ({ local_id: a.local_id, oid: a.oid })),
  })

  const filename = `action-lib-${String(index + 1).padStart(2, '0')}-${slug}.WFaction`
  return { filename, data: lib }
}

// ─── Environment Library Generation ───────────────────────────────────────────
/** @type {Array<{libName: string, libData: object}>} */
const generatedEnvLibs = []

function generateEnvironmentLibrary(index) {
  const envNames = ENV_LIB_THEMES[index]
  const slug = envNames[0].toLowerCase().replace(/\s+/g, '-')
  const envSpecs = []

  for (const envName of envNames) {
    // Pick 3-8 actions from random action libraries
    const numActions = randInt(3, 8)
    const includedActions = []

    for (let i = 0; i < numActions; i++) {
      const libEntry = pick(generatedActionLibs)
      const actionRef = pick(libEntry.actions)
      includedActions.push({
        action_name: actionRef.local_id,
        action_library: libEntry.libName,
        action_oid: actionRef.oid,
        action_version: `${randInt(1, 3)}.${randInt(0, 9)}.0`,
        action_last_modified_date: isoDate(),
        input_parameter_specifications: Array.from({ length: randInt(1, 3) }, inputParam),
        output_parameter_specifications: Array.from({ length: randInt(1, 2) }, outputParam),
      })
    }

    // All 4 resource types represented across environments
    const resourceSpecs = []
    // Force one of each type across the library
    if (envSpecs.length === 0) {
      resourceSpecs.push(resourcePropSpec('binary exclusive use'))
      resourceSpecs.push(resourcePropSpec('named pool'))
    } else if (envSpecs.length === 1) {
      resourceSpecs.push(resourcePropSpec('binary shared use with pool limits'))
      resourceSpecs.push(resourcePropSpec('countable use with pool limits'))
    } else {
      resourceSpecs.push(resourcePropSpec())
    }
    // Add a few random ones
    for (let r = 0; r < randInt(0, 2); r++) resourceSpecs.push(resourcePropSpec())

    envSpecs.push({
      ...managedElement(envName),
      description: `Environment specification for ${envName.toLowerCase()}.`,
      included_actions: includedActions,
      value_property_specifications: Array.from({ length: randInt(2, 5) }, valuePropSpec),
      resource_property_specifications: resourceSpecs,
    })
  }

  const libName = `${envNames[0]} Environment Library`
  const lib = {
    ...managedElement(libName),
    description: `Environment library covering ${envNames.join(', ')}.`,
    environment_specifications: envSpecs,
  }

  generatedEnvLibs.push({ libName, libData: lib })

  const filename = `env-lib-${String(index + 1).padStart(2, '0')}-${slug}.WFenvir`
  return { filename, data: lib }
}

// ─── Step Library Generation ──────────────────────────────────────────────────

const ALL_STEP_TYPES = [
  'ACTION PROXY',
  'INSTRUCTION',
  'TEXT_INPUT',
  'YES_NO',
  'PICK_ONE',
  'CHECKBOX',
  'SCRIPT',
  'SELECT 1',
  'WORKFLOW PROXY',
  'PARALLEL',
  'WAIT ALL',
  'WAIT ANY',
]

function makeStepConfig(stepType) {
  const step = managedElement(`${stepType.replace(/\s+/g, ' ')} Step ${randInt(1, 999)}`, {
    step_type: stepType,
  })

  switch (stepType) {
    case 'ACTION PROXY':
      step.input_parameter_specifications = Array.from({ length: randInt(1, 4) }, inputParam)
      step.output_parameter_specifications = Array.from({ length: randInt(1, 3) }, outputParam)
      step.action_visibility = pick(['opaque', 'observable'])
      break

    case 'INSTRUCTION':
      step.ui_parameter_specifications = [
        { oid: oid(), type: 'Header', value: `Step: ${step.local_id}`, font_size: 18, align: 'center' },
        {
          oid: oid(),
          type: 'Text',
          value: `Perform the ${pick(ACTION_VERBS).toLowerCase()} operation on ${pick(ACTION_NOUNS).toLowerCase()}.`,
          font_size: 14,
        },
        { oid: oid(), type: 'Divider', value: '' },
        { oid: oid(), type: 'SmallText', value: 'Ensure safety protocols are followed.', color: '#666666' },
      ]
      break

    case 'TEXT_INPUT':
      step.output_parameter_name = 'user_text_' + randInt(1, 99)
      step.ui_parameter_specifications = [
        { oid: oid(), type: 'Header', value: 'Enter Value', font_size: 16 },
        { oid: oid(), type: 'Text', value: `Please enter the ${pick(PARAM_NAMES).toLowerCase()}.` },
        { oid: oid(), type: 'TextInput', value: 'Enter here...', lines: randInt(1, 3) },
      ]
      step.text_input_config = {
        required: rand() > 0.3,
        validation_type: pick(['unrestricted', 'number', 'alphanumeric', 'email']),
        default_value: rand() > 0.5 ? String(randInt(0, 100)) : '',
      }
      break

    case 'YES_NO':
      step.output_parameter_name = 'user_confirm_' + randInt(1, 99)
      step.ui_parameter_specifications = [
        { oid: oid(), type: 'Header', value: 'Confirmation Required', font_size: 16 },
        { oid: oid(), type: 'Text', value: `Is the ${pick(ACTION_NOUNS).toLowerCase()} ready for operation?` },
        { oid: oid(), type: 'YesNoButtons', value: 'Confirm', value2: 'Reject' },
      ]
      step.yes_no_config = {
        yes_label: pick(['Yes', 'Confirm', 'Approve', 'Accept']),
        no_label: pick(['No', 'Reject', 'Decline', 'Cancel']),
        yes_value: 'true',
        no_value: 'false',
        default_selection: pick(['yes', 'no', 'none']),
      }
      break

    case 'PICK_ONE': {
      step.output_parameter_name = 'user_selection_' + randInt(1, 99)
      step.ui_parameter_specifications = [
        { oid: oid(), type: 'Header', value: 'Select Option', font_size: 16 },
        { oid: oid(), type: 'Text', value: 'Choose the appropriate operating mode.' },
        { oid: oid(), type: 'PickList', value: 'Options' },
      ]
      const pickOpts = ['Manual', 'Automatic', 'Semi-Auto', 'Override'].map((label) => ({
        id: `opt_${oid()}`,
        label,
        value: label.toLowerCase().replace(/[- ]/g, '_'),
      }))
      step.pick_one_config = { options: pickOpts, default_option_id: pickOpts[0].id }
      break
    }

    case 'CHECKBOX': {
      step.output_parameter_name = 'user_checks_' + randInt(1, 99)
      step.ui_parameter_specifications = [
        { oid: oid(), type: 'Header', value: 'Select Items', font_size: 16 },
        { oid: oid(), type: 'Text', value: 'Check all applicable safety conditions.' },
        { oid: oid(), type: 'CheckboxList', value: 'Safety Checks' },
      ]
      const cbOpts = ['PPE Worn', 'Area Clear', 'Guards in Place', 'Lockout Active', 'Pressure Released'].map(
        (label) => ({
          id: `cb_${oid()}`,
          label,
          value: label.toLowerCase().replace(/\s+/g, '_'),
          default_checked: rand() > 0.7,
        }),
      )
      step.checkbox_config = {
        options: cbOpts,
        output_format: pick(['array', 'csv', 'json']),
        min_selections: 1,
        max_selections: cbOpts.length,
      }
      break
    }

    case 'SCRIPT':
      step.script_config = {
        language: 'python',
        source: [
          '# Auto-generated test script',
          `import math`,
          '',
          `def calculate_${pick(ACTION_VERBS).toLowerCase()}():`,
          `    value = ${randInt(1, 100)} * ${randInt(1, 10)}`,
          `    threshold = ${randInt(50, 200)}`,
          '    if value > threshold:',
          '        return "PASS"',
          '    return "FAIL"',
          '',
          `result = calculate_${pick(ACTION_VERBS).toLowerCase()}()`,
          'print(f"Result: {result}")',
        ].join('\n'),
      }
      step.input_parameter_specifications = Array.from({ length: randInt(1, 2) }, inputParam)
      step.output_parameter_specifications = Array.from({ length: randInt(1, 2) }, outputParam)
      break

    case 'SELECT 1': {
      const numOpts = randInt(2, 3)
      const options = []
      for (let i = 0; i < numOpts; i++) {
        options.push({
          id: `sel_${oid()}`,
          label: `Branch ${String.fromCharCode(65 + i)}`,
          operator: pick(['==', '!=', '>', '<', '>=', '<=']),
          value: String(randInt(0, 100)),
          value_type: 'literal',
          is_default: i === numOpts - 1,
        })
      }
      step.select1_config = {
        input_name: pick(VALUE_PROP_NAMES),
        input_value_type: 'property',
        options,
      }
      break
    }

    case 'WORKFLOW PROXY':
      // Child workflow will be added in workflow generation
      break

    case 'PARALLEL':
    case 'WAIT ALL':
    case 'WAIT ANY':
      // Control flow steps have no special config
      break
  }

  return step
}

/** @type {Array<{libName: string, libData: object}>} */
const generatedStepLibs = []

function generateStepLibrary(index) {
  const theme = STEP_LIB_THEMES[index]
  const slug = theme.toLowerCase().replace(/\s+/g, '-')
  const numSteps = randInt(7, 20)

  // Ensure all step types are covered across the 3 libraries
  const steps = []

  // First, add required types for this library's share
  const share = Math.ceil(ALL_STEP_TYPES.length / 3)
  const startIdx = index * share
  const endIdx = Math.min(startIdx + share, ALL_STEP_TYPES.length)
  for (let i = startIdx; i < endIdx; i++) {
    steps.push(makeStepConfig(ALL_STEP_TYPES[i]))
  }

  // Fill remaining with random types
  while (steps.length < numSteps) {
    steps.push(makeStepConfig(pick(ALL_STEP_TYPES)))
  }

  const lib = {
    ...managedElement(theme),
    description: `Step library: ${theme}.`,
    library_steps: shuffle(steps),
  }

  generatedStepLibs.push({ libName: theme, libData: lib })

  const filename = `step-lib-${String(index + 1).padStart(2, '0')}-${slug}.WFslibX`
  return { filename, data: lib }
}

// ─── Workflow Generation ──────────────────────────────────────────────────────

const SEQUENTIAL_STEP_TYPES = ['ACTION PROXY', 'INSTRUCTION', 'TEXT_INPUT', 'YES_NO', 'PICK_ONE', 'CHECKBOX', 'SCRIPT']

function generateChildWorkflow(name) {
  const numSteps = randInt(3, 8)
  const steps = []
  const connections = []
  let x = 100
  const y = 300

  // START
  const startStep = managedElement('Start', { step_type: 'START', position: { x, y } })
  steps.push(startStep)
  let prevOid = startStep.oid
  x += 250

  for (let i = 0; i < numSteps; i++) {
    const stepType = pick(SEQUENTIAL_STEP_TYPES)
    const step = makeStepConfig(stepType)
    step.position = { x, y }
    steps.push(step)
    connections.push({ from_step_id: prevOid, to_step_id: step.oid, connection_id: oid() })
    prevOid = step.oid
    x += 250
  }

  // END
  const endStep = managedElement('End', { step_type: 'END', position: { x, y } })
  steps.push(endStep)
  connections.push({ from_step_id: prevOid, to_step_id: endStep.oid, connection_id: oid() })

  return {
    ...managedElement(name),
    schemaVersion: '3.0',
    steps,
    connections,
    viewport: { x: 0, y: 0, zoom: 0.75 },
  }
}

/** Tracks which action library names are referenced by a workflow lib's embedded envs. */
function collectActionLibNames(workflowLibData) {
  const names = new Set()
  for (const wf of workflowLibData.workflow_specifications) {
    for (const env of wf.environment_specifications || []) {
      for (const ia of env.included_actions || []) {
        if (ia.action_library) names.add(ia.action_library)
      }
    }
  }
  return [...names]
}

function generateWorkflow(name) {
  const targetSteps = randInt(10, 60)
  const steps = []
  const connections = []
  const childWorkflows = []
  let x = 100
  const baseY = 300

  // Track which step types we've used
  const usedTypes = new Set()

  // START
  const startStep = managedElement('Start', { step_type: 'START', position: { x, y: baseY } })
  steps.push(startStep)
  usedTypes.add('START')
  let prevOid = startStep.oid
  x += 250

  function addSequentialStep(stepType, yPos) {
    const step = makeStepConfig(stepType)
    step.position = { x, y: yPos }
    steps.push(step)
    usedTypes.add(stepType)
    return step
  }

  while (steps.length < targetSteps - 1) {
    const roll = rand()

    if (roll < 0.15 && steps.length + 6 < targetSteps) {
      // ── PARALLEL block ──
      const parallelStep = managedElement('Parallel Fork', { step_type: 'PARALLEL', position: { x, y: baseY } })
      steps.push(parallelStep)
      usedTypes.add('PARALLEL')
      connections.push({ from_step_id: prevOid, to_step_id: parallelStep.oid, connection_id: oid() })
      x += 250

      const numBranches = randInt(2, 3)
      const branchEnds = []

      for (let b = 0; b < numBranches; b++) {
        const branchY = baseY + (b - Math.floor(numBranches / 2)) * 150
        const branchLen = randInt(1, 2)
        let branchPrev = parallelStep.oid
        let branchX = x

        for (let s = 0; s < branchLen; s++) {
          const st = pick(SEQUENTIAL_STEP_TYPES)
          const step = makeStepConfig(st)
          step.position = { x: branchX, y: branchY }
          steps.push(step)
          usedTypes.add(st)
          connections.push({ from_step_id: branchPrev, to_step_id: step.oid, connection_id: oid() })
          branchPrev = step.oid
          branchX += 250
        }
        branchEnds.push(branchPrev)
        x = Math.max(x, branchX)
      }

      // WAIT ALL
      const waitAllStep = managedElement('Wait All Join', { step_type: 'WAIT ALL', position: { x, y: baseY } })
      steps.push(waitAllStep)
      usedTypes.add('WAIT ALL')
      for (const endOid of branchEnds) {
        connections.push({ from_step_id: endOid, to_step_id: waitAllStep.oid, connection_id: oid() })
      }
      prevOid = waitAllStep.oid
      x += 250
    } else if (roll < 0.27 && steps.length + 5 < targetSteps) {
      // ── SELECT 1 block ──
      const numOpts = randInt(2, 3)
      const options = []
      for (let i = 0; i < numOpts; i++) {
        options.push({
          id: `sel_${oid()}`,
          label: `Condition ${String.fromCharCode(65 + i)}`,
          operator: pick(['==', '!=', '>', '<']),
          value: String(randInt(0, 100)),
          value_type: 'literal',
          is_default: i === numOpts - 1,
        })
      }

      const selectStep = managedElement('Decision Gate', {
        step_type: 'SELECT 1',
        position: { x, y: baseY },
        select1_config: {
          input_name: pick(VALUE_PROP_NAMES),
          input_value_type: 'property',
          options,
        },
      })
      steps.push(selectStep)
      usedTypes.add('SELECT 1')
      connections.push({ from_step_id: prevOid, to_step_id: selectStep.oid, connection_id: oid() })
      x += 250

      // Merge step (placed after branches)
      const branchEnds = []
      let maxBranchX = x

      for (let b = 0; b < numOpts; b++) {
        const branchY = baseY + (b - Math.floor(numOpts / 2)) * 150
        const st = pick(SEQUENTIAL_STEP_TYPES)
        const branchStep = makeStepConfig(st)
        branchStep.position = { x, y: branchY }
        steps.push(branchStep)
        usedTypes.add(st)
        connections.push({
          from_step_id: selectStep.oid,
          to_step_id: branchStep.oid,
          connection_id: oid(),
          source_handle_id: options[b].id,
          condition: `${options[b].label}: ${options[b].operator} ${options[b].value}`,
        })
        branchEnds.push(branchStep.oid)
        maxBranchX = Math.max(maxBranchX, x + 250)
      }

      x = maxBranchX

      // Merge point - next sequential step
      const mergeType = pick(SEQUENTIAL_STEP_TYPES)
      const mergeStep = makeStepConfig(mergeType)
      mergeStep.position = { x, y: baseY }
      steps.push(mergeStep)
      usedTypes.add(mergeType)
      for (const endOid of branchEnds) {
        connections.push({ from_step_id: endOid, to_step_id: mergeStep.oid, connection_id: oid() })
      }
      prevOid = mergeStep.oid
      x += 250
    } else if (roll < 0.35 && steps.length + 2 < targetSteps) {
      // ── WORKFLOW PROXY ──
      const childName = `Sub-${name}-${steps.length}`
      const childWf = generateChildWorkflow(childName)
      childWorkflows.push(childWf)

      const proxyStep = managedElement(`Call ${childName}`, {
        step_type: 'WORKFLOW PROXY',
        position: { x, y: baseY },
      })
      steps.push(proxyStep)
      usedTypes.add('WORKFLOW PROXY')
      connections.push({ from_step_id: prevOid, to_step_id: proxyStep.oid, connection_id: oid() })
      prevOid = proxyStep.oid
      x += 250
    } else {
      // ── Sequential step ──
      const stepType = pick(SEQUENTIAL_STEP_TYPES)
      const step = addSequentialStep(stepType, baseY)
      connections.push({ from_step_id: prevOid, to_step_id: step.oid, connection_id: oid() })
      prevOid = step.oid
      x += 250
    }
  }

  // Force any missing required types (from the sequential types)
  const requiredCoverage = ['ACTION PROXY', 'INSTRUCTION', 'TEXT_INPUT', 'YES_NO', 'SCRIPT']
  for (const rt of requiredCoverage) {
    if (!usedTypes.has(rt)) {
      const step = makeStepConfig(rt)
      step.position = { x, y: baseY }
      steps.push(step)
      connections.push({ from_step_id: prevOid, to_step_id: step.oid, connection_id: oid() })
      prevOid = step.oid
      x += 250
    }
  }

  // END
  const endStep = managedElement('End', { step_type: 'END', position: { x, y: baseY } })
  steps.push(endStep)
  usedTypes.add('END')
  connections.push({ from_step_id: prevOid, to_step_id: endStep.oid, connection_id: oid() })

  // Build embedded environment specs
  const numEnvs = randInt(1, 2)
  const envSpecs = []
  for (let e = 0; e < numEnvs; e++) {
    const envTheme = pick(ENV_LIB_THEMES)
    const envName = envTheme[randInt(0, envTheme.length - 1)]
    const numActions = randInt(2, 4)
    const includedActions = []
    for (let a = 0; a < numActions; a++) {
      if (generatedActionLibs.length > 0) {
        const libEntry = pick(generatedActionLibs)
        const actionRef = pick(libEntry.actions)
        includedActions.push({
          action_name: actionRef.local_id,
          action_library: libEntry.libName,
        })
      }
    }
    envSpecs.push({
      ...managedElement(`${envName} Env`),
      library_name: `${envName} Environment Library`,
      included_actions: includedActions,
      value_property_specifications: Array.from({ length: randInt(1, 3) }, valuePropSpec),
      resource_property_specifications: [resourcePropSpec()],
    })
  }

  // Build workflow specification
  const wfSpec = {
    ...managedElement(name),
    schemaVersion: '3.0',
    steps,
    connections,
    environment_specifications: envSpecs,
    value_property_specifications: Array.from({ length: randInt(2, 5) }, valuePropSpec),
    starting_parameter_specifications: Array.from({ length: randInt(1, 3) }, () => ({
      id: `start_${pick(PARAM_NAMES)}_${randInt(1, 99)}`,
      oid: oid(),
      description: 'Starting parameter',
      default_value: String(randInt(0, 500)),
    })),
    output_parameter_specifications: Array.from({ length: randInt(1, 3) }, outputParam),
    resource_property_specifications: [
      resourcePropSpec('binary exclusive use'),
      resourcePropSpec('countable use with pool limits'),
    ],
    viewport: { x: 0, y: 0, zoom: 0.5 },
  }

  if (childWorkflows.length > 0) {
    wfSpec.child_workflows = childWorkflows
  }

  return wfSpec
}

function generateWorkflowLibrary(index) {
  const theme = WORKFLOW_LIB_THEMES[index]
  const slug = theme.toLowerCase().replace(/\s+/g, '-')
  const names = WORKFLOW_NAMES[index]

  const workflows = names.map((name) => generateWorkflow(name))

  const lib = {
    ...managedElement(theme),
    description: `Workflow library for ${theme.toLowerCase()} procedures.`,
    workflow_specifications: workflows,
  }

  const filename = `workflow-lib-${String(index + 1).padStart(2, '0')}-${slug}.WFlibX`
  return { filename, data: lib, theme }
}

// ─── ZIP packaging for workflow libraries ─────────────────────────────────────

async function writeWorkflowLibraryZip(filename, workflowLibData, theme) {
  const zip = new JSZip()
  const libraryName = theme

  // Root: workflow library JSON as {name}.WFlibX
  zip.file(`${libraryName}.WFlibX`, JSON.stringify(workflowLibData, null, 2))

  // Collect referenced action library names from embedded env specs
  const referencedActionLibNames = collectActionLibNames(workflowLibData)

  // Include referenced action libraries under actions/
  const includedActionLibs = []
  for (const actionLibName of referencedActionLibNames) {
    const entry = generatedActionLibs.find((a) => a.libName === actionLibName)
    if (entry) {
      if (includedActionLibs.some((a) => a.libName === entry.libName)) continue
      zip.file(`actions/${entry.libName}.WFaction`, JSON.stringify(entry.libData, null, 2))
      includedActionLibs.push(entry)
    }
  }

  // Include a subset of environment libraries under environments/
  const includedEnvLibs = []
  const numEnvs = Math.min(2, generatedEnvLibs.length)
  for (let i = 0; i < numEnvs; i++) {
    // Rotate through env libs based on workflow lib index
    const envIdx = (WORKFLOW_LIB_THEMES.indexOf(theme) * 2 + i) % generatedEnvLibs.length
    const entry = generatedEnvLibs[envIdx]
    zip.file(`environments/${entry.libName}.WFenvir`, JSON.stringify(entry.libData, null, 2))
    includedEnvLibs.push(entry)
  }

  // Include one step library under steps/
  const includedStepLibs = []
  if (generatedStepLibs.length > 0) {
    const stepIdx = WORKFLOW_LIB_THEMES.indexOf(theme) % generatedStepLibs.length
    const entry = generatedStepLibs[stepIdx]
    zip.file(`steps/${entry.libName}.WFslibX`, JSON.stringify(entry.libData, null, 2))
    includedStepLibs.push(entry)
  }

  // Manifest
  const manifest = {
    packageType: 'workflow-library',
    packageVersion: '1.0',
    libraryName,
    stepLibraries: includedStepLibs.map((s) => s.libName),
    environmentLibraries: includedEnvLibs.map((e) => e.libName),
    actionLibraries: includedActionLibs.map((a) => a.libName),
    createdAt: new Date().toISOString(),
    files: [
      { path: `${libraryName}.WFlibX`, type: 'workflow-library' },
      ...includedStepLibs.map((s) => ({
        path: `steps/${s.libName}.WFslibX`,
        type: 'step-library',
      })),
      ...includedEnvLibs.map((e) => ({
        path: `environments/${e.libName}.WFenvir`,
        type: 'environment-library',
      })),
      ...includedActionLibs.map((a) => ({
        path: `actions/${a.libName}.WFaction`,
        type: 'action-library',
      })),
    ],
  }
  zip.file('manifest.json', JSON.stringify(manifest, null, 2))

  const buf = await zip.generateAsync({ type: 'nodebuffer' })
  const path = join(OUT_DIR, filename)
  writeFileSync(path, buf)
  return { stepLibs: includedStepLibs.length, envLibs: includedEnvLibs.length, actionLibs: includedActionLibs.length }
}

// ─── Conflict-Heavy WFlibX fixture ───────────────────────────────────────────
/**
 * Generates conflict-heavy.WFlibX — a deterministic bundle designed so that when
 * imported against the "seed" state (produced by conflict-seed.WFlibX imported first),
 * the import plan contains at least one row of every status:
 *
 *   create          — a brand-new library + spec whose OIDs/names don't exist in seed
 *   add-to-existing — a spec in an existing (seed) library, but a new spec name
 *   conflict        — a spec whose name matches an existing seed spec, but different OID
 *   no-op           — a spec whose OID matches exactly what was seeded
 *
 * Both fixture files use fixed deterministic OIDs (prefixed CHK-) so the test
 * is reproducible across runs without depending on random generation.
 */

const CH = {
  // Seed library (exists in DB after seed import; conflict bundle references same name+type)
  SEED_LIB_OID: 'CHK-SEED-LIB-001',
  SEED_LIB_NAME: 'Conflict Seed Library',

  // Seed specs
  NOOP_SPEC_OID: 'CHK-SEED-SPEC-NOOP', // same OID in conflict bundle → no-op
  NOOP_SPEC_NAME: 'NoOp Workflow',

  CONFLICT_SPEC_OID_SEED: 'CHK-SEED-SPEC-CONFLICT', // in seed DB
  CONFLICT_SPEC_OID_BUNDLE: 'CHK-BNDL-SPEC-CONFLICT', // different OID, same name → conflict
  CONFLICT_SPEC_NAME: 'Conflict Workflow',

  ADD_SPEC_OID: 'CHK-BNDL-SPEC-ADD', // new spec in the existing seed library → add-to-existing
  ADD_SPEC_NAME: 'Add-To-Existing Workflow',

  // Brand-new library (not in seed DB at all → create)
  NEW_LIB_OID: 'CHK-BNDL-LIB-NEW',
  NEW_LIB_NAME: 'Brand New Library',

  NEW_SPEC_OID: 'CHK-BNDL-SPEC-NEW',
  NEW_SPEC_NAME: 'Brand New Workflow',
}

function wfLibJson(oid, name, version, specs) {
  return JSON.stringify(
    {
      oid,
      local_id: name,
      version,
      last_modified_date: '2026-01-01T00:00:00.000Z',
      description: name,
      workflow_specifications: specs.map((s) => ({
        oid: s.oid,
        local_id: s.name,
        version: s.version || '1.0.0',
        steps: [],
        connections: [],
      })),
    },
    null,
    2,
  )
}

function manifestJson(libName, libOidIdx, specOidIdx, files) {
  return JSON.stringify(
    {
      packageType: 'workflow-library',
      packageVersion: '1.1',
      libraryName: libName,
      createdAt: '2026-01-01T00:00:00.000Z',
      files,
      oidIndex: {
        libraries: libOidIdx,
        specifications: specOidIdx,
      },
    },
    null,
    2,
  )
}

async function writeConflictFixtures() {
  // ── conflict-seed.WFlibX ──────────────────────────────────────────────────
  // Import this first to populate the DB with the "before" state.
  {
    const zip = new JSZip()
    const libFile = `${CH.SEED_LIB_NAME}.WFlib`
    zip.file(
      libFile,
      wfLibJson(CH.SEED_LIB_OID, CH.SEED_LIB_NAME, '1.0.0', [
        { oid: CH.NOOP_SPEC_OID, name: CH.NOOP_SPEC_NAME },
        { oid: CH.CONFLICT_SPEC_OID_SEED, name: CH.CONFLICT_SPEC_NAME },
      ]),
    )
    zip.file(
      'manifest.json',
      manifestJson(
        CH.SEED_LIB_NAME,
        [{ oid: CH.SEED_LIB_OID, name: CH.SEED_LIB_NAME, entityType: 'workflow', version: '1.0.0' }],
        [
          { oid: CH.NOOP_SPEC_OID, libraryOid: CH.SEED_LIB_OID, name: CH.NOOP_SPEC_NAME, version: '1.0.0' },
          {
            oid: CH.CONFLICT_SPEC_OID_SEED,
            libraryOid: CH.SEED_LIB_OID,
            name: CH.CONFLICT_SPEC_NAME,
            version: '1.0.0',
          },
        ],
        [{ path: libFile, type: 'workflow-library' }],
      ),
    )
    const buf = await zip.generateAsync({ type: 'nodebuffer' })
    writeFileSync(join(OUT_DIR, 'conflict-seed.WFlibX'), buf)
  }

  // ── conflict-heavy.WFlibX ─────────────────────────────────────────────────
  // Import this AFTER conflict-seed to exercise all 4 plan status types.
  {
    const zip = new JSZip()

    // Existing seed library file (different spec OIDs to produce conflict + add-to-existing)
    const seedLibFile = `${CH.SEED_LIB_NAME}.WFlib`
    zip.file(
      seedLibFile,
      wfLibJson(CH.SEED_LIB_OID, CH.SEED_LIB_NAME, '1.1.0', [
        { oid: CH.NOOP_SPEC_OID, name: CH.NOOP_SPEC_NAME, version: '1.0.0' }, // no-op
        { oid: CH.CONFLICT_SPEC_OID_BUNDLE, name: CH.CONFLICT_SPEC_NAME, version: '2.0.0' }, // conflict
        { oid: CH.ADD_SPEC_OID, name: CH.ADD_SPEC_NAME, version: '1.0.0' }, // add-to-existing
      ]),
    )

    // New library file (not in seed DB → create)
    const newLibFile = `${CH.NEW_LIB_NAME}.WFlib`
    zip.file(
      newLibFile,
      wfLibJson(CH.NEW_LIB_OID, CH.NEW_LIB_NAME, '1.0.0', [
        { oid: CH.NEW_SPEC_OID, name: CH.NEW_SPEC_NAME, version: '1.0.0' },
      ]),
    )

    zip.file(
      'manifest.json',
      manifestJson(
        CH.SEED_LIB_NAME,
        [
          { oid: CH.SEED_LIB_OID, name: CH.SEED_LIB_NAME, entityType: 'workflow', version: '1.1.0' },
          { oid: CH.NEW_LIB_OID, name: CH.NEW_LIB_NAME, entityType: 'workflow', version: '1.0.0' },
        ],
        [
          { oid: CH.NOOP_SPEC_OID, libraryOid: CH.SEED_LIB_OID, name: CH.NOOP_SPEC_NAME, version: '1.0.0' },
          {
            oid: CH.CONFLICT_SPEC_OID_BUNDLE,
            libraryOid: CH.SEED_LIB_OID,
            name: CH.CONFLICT_SPEC_NAME,
            version: '2.0.0',
          },
          { oid: CH.ADD_SPEC_OID, libraryOid: CH.SEED_LIB_OID, name: CH.ADD_SPEC_NAME, version: '1.0.0' },
          { oid: CH.NEW_SPEC_OID, libraryOid: CH.NEW_LIB_OID, name: CH.NEW_SPEC_NAME, version: '1.0.0' },
        ],
        [
          { path: seedLibFile, type: 'workflow-library' },
          { path: newLibFile, type: 'workflow-library' },
        ],
      ),
    )

    const buf = await zip.generateAsync({ type: 'nodebuffer' })
    writeFileSync(join(OUT_DIR, 'conflict-heavy.WFlibX'), buf)
  }

  console.log('  conflict-seed.WFlibX  (seed fixture — import first)')
  console.log('  conflict-heavy.WFlibX (conflict fixture — import after seed)')
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (existsSync(OUT_DIR)) {
    // Clean old files
    const { readdirSync, unlinkSync } = await import('fs')
    for (const f of readdirSync(OUT_DIR)) {
      unlinkSync(join(OUT_DIR, f))
    }
  } else {
    mkdirSync(OUT_DIR, { recursive: true })
  }

  const jsonFiles = []
  const workflowLibs = []

  // 1. Action libraries (20) — .WFaction
  console.log('Generating 20 action libraries (.WFaction)...')
  for (let i = 0; i < 20; i++) {
    jsonFiles.push(generateActionLibrary(i))
  }

  // 2. Environment libraries (8) — .WFenvir
  console.log('Generating 8 environment libraries (.WFenvir)...')
  for (let i = 0; i < 8; i++) {
    jsonFiles.push(generateEnvironmentLibrary(i))
  }

  // 3. Step libraries (3) — .WFslibX
  console.log('Generating 3 step libraries (.WFslibX)...')
  for (let i = 0; i < 3; i++) {
    jsonFiles.push(generateStepLibrary(i))
  }

  // 4. Workflow libraries (4) — .WFlibX (ZIP packages)
  console.log('Generating 4 workflow libraries (.WFlibX ZIP packages)...')
  for (let i = 0; i < 4; i++) {
    workflowLibs.push(generateWorkflowLibrary(i))
  }

  // Write plain JSON files
  let totalSpecs = 0
  for (const { filename, data } of jsonFiles) {
    const path = join(OUT_DIR, filename)
    const json = JSON.stringify(data, null, 2)
    writeFileSync(path, json, 'utf-8')

    if (data.action_specifications) totalSpecs += data.action_specifications.length
    if (data.environment_specifications) totalSpecs += data.environment_specifications.length
    if (data.library_steps) totalSpecs += data.library_steps.length
  }

  // Write workflow library ZIPs
  for (const { filename, data, theme } of workflowLibs) {
    const counts = await writeWorkflowLibraryZip(filename, data, theme)
    console.log(
      `  ${filename}: ${data.workflow_specifications.length} workflows, ` +
        `bundled ${counts.stepLibs} step lib(s), ${counts.envLibs} env lib(s), ${counts.actionLibs} action lib(s)`,
    )

    totalSpecs += data.workflow_specifications.length
    for (const wf of data.workflow_specifications) {
      totalSpecs += wf.steps.length
    }
  }

  // 5. Conflict-heavy E2E fixtures
  console.log('\nGenerating conflict-heavy E2E fixtures...')
  await writeConflictFixtures()

  const allFiles = [...jsonFiles, ...workflowLibs]
  console.log(`\nDone! Generated ${allFiles.length + 2} files in ${OUT_DIR}`)
  console.log(`Total specifications/elements: ${totalSpecs}`)
  console.log('\nFiles:')
  for (const { filename } of jsonFiles) {
    console.log(`  ${filename}`)
  }
  for (const { filename } of workflowLibs) {
    console.log(`  ${filename}  (ZIP)`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
