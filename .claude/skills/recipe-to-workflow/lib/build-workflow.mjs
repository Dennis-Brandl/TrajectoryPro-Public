// Recipe spec -> Trajectory master workflow library (schemaVersion 5.0).
//
// Graph shape produced here:
//
//   START -> [ingredients] -> [equipment question] -> SELECT 1 -+-> [gas steps] --+-> [shared steps] -> END
//                                                               +-> [electric] ---+
//                                                               +-> [convection] -+
//
// A recipe with no `equipment` block is a straight line with no SELECT 1 at all.
// A recipe may branch more than once: every run of steps carrying `only` opens a
// fresh SELECT 1 on the same stored answer, so the question is asked once and
// consulted as often as the method needs.

import { instructionScreen, listScreen, questionScreen, estimatePhoneHeight, oid, ISO, PHONE } from './build-forms.mjs'

export const SCHEMA_VERSION = '5.0'

const STEP_SPACING_Y = 170
const BRANCH_SPACING_X = 330

function managed(localId, seed) {
  return { local_id: localId, oid: oid(seed), version: '1.0.0', last_modified_date: ISO }
}

/**
 * A screen step. Mission Pilot and Mission XO draw the form, then a button row
 * pinned to the bottom of the viewport.
 *
 * `button_bar` is what puts the buttons in that fixed row rather than in the
 * scrolling form, and it is why no button blocks appear in the form document:
 * the two are alternatives, not layers (MissionDesigner/src/lib/form-document/
 * fixed-bar.ts). The button's text travels as a `Button` ui-parameter.
 *
 * allow_back / allow_stop add Back and Stop to that same row.
 */
function screenStep(node) {
  const step = {
    ...managed(node.localId, node.seed),
    step_type: 'USER_INTERACTION',
    position: { x: node.x, y: node.y },
    description: node.title,
    form_document: node.doc,
    button_bar: { format: 'fixed' },
    ui_parameter_specifications: [{ oid: oid(node.seed + ':btn'), type: 'Button', value: node.button }],
    allow_back: node.allowBack,
    allow_stop: node.allowStop,
  }
  return step
}

function select1Step(node, question) {
  return {
    ...managed(node.localId, node.seed),
    step_type: 'SELECT 1',
    position: { x: node.x, y: node.y },
    description: 'Which ' + question.noun + '?',
    select1_config: {
      input_name: question.property + '.Value',
      input_value_type: 'property',
      options: question.options.map((o, i) => ({
        id: oid(node.seed + ':opt:' + o.value),
        label: o.label,
        operator: '==',
        value: o.value,
        value_type: 'literal',
        // The first choice is also the fallback. The question is a required radio,
        // so every run should match an option exactly; marking one default means a
        // value that somehow misses them all still routes somewhere instead of
        // dead-ending the run.
        is_default: i === 0,
      })),
    },
  }
}

/** Split a long list across as many screens as the phone budget needs. */
function splitList(seed, title, lines, intro) {
  const pages = []
  let page = []
  const flush = () => {
    if (page.length === 0) return
    const n = pages.length + 1
    pages.push({ lines: page, index: n })
    page = []
  }
  for (const line of lines) {
    const trial = page.concat([line])
    const doc = listScreen(seed + ':probe', title, trial, pages.length === 0 ? intro : undefined)
    if (estimatePhoneHeight(doc) > PHONE.usableHeight && page.length > 0) flush()
    page = page.length === 0 ? [line] : trial
  }
  flush()
  return pages.map((p, i) => ({
    title: pages.length === 1 ? title : title + ' (' + (i + 1) + ' of ' + pages.length + ')',
    lines: p.lines,
    intro: i === 0 ? intro : undefined,
  }))
}

/**
 * Turn one recipe spec into a workflow specification.
 *
 * Returns { spec, report } — the report carries the phone measurements so the
 * caller can print them and fail the build on an overflowing screen.
 */
export function buildWorkflow(recipe) {
  const slug = recipe.slug
  const seed = (s) => slug + ':' + s
  const steps = []
  const connections = []
  const report = { slug, name: recipe.name, screens: [], overflow: [] }

  let y = 0
  const nextY = () => {
    y += STEP_SPACING_Y
    return y
  }

  const startStep = { ...managed('start', seed('start')), step_type: 'START', position: { x: 0, y: 0 } }
  steps.push(startStep)

  // --- the linear plan of screens -----------------------------------------
  const plan = []
  const pages = splitList(
    seed('ingredients'),
    'What you need',
    recipe.ingredients,
    recipe.serves ? 'Makes ' + recipe.serves + '.' : undefined,
  )
  pages.forEach((p, i) => {
    plan.push({ kind: 'list', key: 'ingredients-' + (i + 1), title: p.title, lines: p.lines, intro: p.intro, only: null })
  })
  if (recipe.equipment) {
    plan.push({ kind: 'question', key: 'equipment', title: recipe.equipment.prompt, only: null })
  }
  recipe.steps.forEach((s, i) => {
    plan.push({ kind: 'step', key: 'step-' + (i + 1), step: s, title: s.title, only: s.only || null })
  })

  // --- build the screen nodes ---------------------------------------------
  const nodes = plan.map((item, i) => {
    const isLast = i === plan.length - 1
    const key = item.key
    const s = seed(key)
    let doc
    if (item.kind === 'list') doc = listScreen(s, item.title, item.lines, item.intro)
    else if (item.kind === 'question') doc = questionScreen(s, recipe.equipment)
    else doc = instructionScreen(s, item.step)

    const height = estimatePhoneHeight(doc)
    report.screens.push({ key, title: item.title, phoneHeight: height })
    if (height > PHONE.usableHeight) report.overflow.push({ key, title: item.title, phoneHeight: height })

    const override = item.kind === 'step' ? item.step : {}
    return {
      localId: key,
      seed: s,
      title: item.title,
      doc,
      only: item.only,
      x: 0,
      y: 0,
      button: override.button || (isLast ? 'Done' : 'Next'),
      // Back needs somewhere to go back to, so the first screen never offers it
      // (MissionDesigner/src/lib/export/fixed-bar-checks.ts warns about exactly
      // this). Stop is offered everywhere except the last screen, where the run
      // is finishing anyway.
      allowBack: override.allowBack !== undefined ? override.allowBack : i > 0,
      allowStop: override.allowStop !== undefined ? override.allowStop : !isLast,
    }
  })

  // --- wire the graph ------------------------------------------------------
  // `pending` holds the open ends that must connect to whatever comes next.
  // A handle is set only for edges leaving a SELECT 1.
  let pending = [{ oid: startStep.oid, handle: null }]
  const connect = (to) => {
    for (const p of pending) {
      const c = { from_step_id: p.oid, to_step_id: to }
      if (p.handle) {
        c.connection_id = p.handle
        c.source_handle_id = p.handle
      }
      connections.push(c)
    }
  }

  let i = 0
  let branchRound = 0
  while (i < nodes.length) {
    const node = nodes[i]

    if (!node.only) {
      node.y = nextY()
      const step = screenStep(node)
      steps.push(step)
      connect(step.oid)
      pending = [{ oid: step.oid, handle: null }]
      i++
      continue
    }

    // A branch region: every consecutive node that names the options it belongs to.
    branchRound++
    const region = []
    while (i < nodes.length && nodes[i].only) {
      region.push(nodes[i])
      i++
    }

    const sel = {
      localId: 'select-' + branchRound,
      seed: seed('select-' + branchRound),
      x: 0,
      y: nextY(),
    }
    const selStep = select1Step(sel, recipe.equipment)
    steps.push(selStep)
    connect(selStep.oid)

    const options = recipe.equipment.options
    const nextPending = []
    const branchTopY = y
    options.forEach((opt, oi) => {
      const handle = oid(sel.seed + ':opt:' + opt.value)
      const mine = region.filter((n) => n.only.includes(opt.value))
      const x = Math.round((oi - (options.length - 1) / 2) * BRANCH_SPACING_X)
      if (mine.length === 0) {
        // Nothing special for this equipment: fall straight through to the join.
        nextPending.push({ oid: selStep.oid, handle })
        return
      }
      let prev = { oid: selStep.oid, handle }
      mine.forEach((n, k) => {
        n.x = x
        n.y = branchTopY + (k + 1) * STEP_SPACING_Y
        const step = screenStep(n)
        steps.push(step)
        const c = { from_step_id: prev.oid, to_step_id: step.oid }
        if (prev.handle) {
          c.connection_id = prev.handle
          c.source_handle_id = prev.handle
        }
        connections.push(c)
        prev = { oid: step.oid, handle: null }
      })
      nextPending.push(prev)
    })

    const deepest = Math.max(...options.map((o) => region.filter((n) => n.only.includes(o.value)).length))
    y = branchTopY + deepest * STEP_SPACING_Y
    pending = nextPending
  }

  const endStep = { ...managed('end', seed('end')), step_type: 'END', position: { x: 0, y: nextY() } }
  steps.push(endStep)
  connect(endStep.oid)

  const spec = {
    ...managed(recipe.name, seed('workflow')),
    description: recipe.summary,
    schemaVersion: SCHEMA_VERSION,
    state: 'Draft',
    display_style: 'flowchart',
    library_name: recipe.library || 'Recipes',
    steps,
    connections,
    viewport: { x: 0, y: 0, zoom: 1 },
  }
  if (recipe.equipment) {
    spec.value_property_specifications = [
      {
        name: recipe.equipment.property,
        oid: oid(seed('prop:' + recipe.equipment.property)),
        entries: [{ name: 'Value', value: '' }],
      },
    ]
  }

  report.stepCount = steps.length
  report.connectionCount = connections.length
  return { spec, report }
}

/**
 * Wrap one or more workflow specs in the `.WFlibX`-style library envelope.
 *
 * Not used by the .WFmasterX build — Mission Commander loads only .WFmasterX —
 * but kept because importing several recipes into Mission Designer at once is a
 * one-liner on top of it. The envelope is itself a managed element, so it carries
 * the same four identity fields every step and workflow does; leaving them off
 * fails the library schema with four "must have required property" errors that
 * name no file.
 */
export function buildLibrary(specs, libraryName) {
  return {
    ...managed(libraryName, 'library:' + libraryName),
    library_name: libraryName,
    workflow_specifications: specs,
  }
}
