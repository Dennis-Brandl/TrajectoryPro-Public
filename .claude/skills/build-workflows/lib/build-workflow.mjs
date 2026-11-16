// Recipe spec -> Trajectory master workflow library (schemaVersion 5.0).
//
// Graph shape produced here:
//
//   START -> [ingredients] -> [equipment question] -> SELECT 1 -+-> [gas] ------+
//                                                               +-> [electric] -+-> WAIT ANY -> [shared] -> END
//                                                               +-> [convection]+
//
// The branches rejoin through a WAIT ANY rather than running several edges into the
// next shared step. WAIT ANY is the join step type (MissionEngine back-target.ts
// isJoinType), it auto-completes on the first arrival (transition.ts), and it keeps
// the diagram honest: one line out of the branch set instead of a step with three
// inbound edges.
//
// A spec with no `equipment`/`question` block is a straight line with no SELECT 1 at
// all. A spec may branch more than once: every run of steps carrying `only` opens a
// fresh SELECT 1 on the same stored answer, so the question is asked once and
// consulted as often as the method needs.
//
// Steps carrying `track` fork instead of choosing:
//
//   ... -> PARALLEL -+-> [track A steps] -+
//                    +-> [track B steps] -+-> WAIT ALL -> [shared] -> ...
//                    +-> [track C steps] -+
//
// Every track runs at once and WAIT ALL holds the procedure until all of them finish
// — the difference that matters for an emergency, where sounding the alarm must not
// wait on the phone call to dispatch. A run of consecutive steps carrying `track`
// forms one region; each distinct track name becomes one branch, in first-appearance
// order.

import {
  instructionScreen,
  listScreen,
  questionScreen,
  questionOutputName,
  estimatePhoneHeight,
  oid,
  ISO,
  PHONE,
} from './build-forms.mjs'
import { autoLayout } from './layout.mjs'

export const SCHEMA_VERSION = '5.0'

// Positions are not computed here. Every step is created at the origin and the whole
// graph is run through Mission Designer's own dagre auto-layout at the end, so an
// imported recipe sits exactly where pressing Auto Layout in the editor would put it.
const ORIGIN = { x: 0, y: 0 }

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
    position: { ...ORIGIN },
    description: node.title,
    form_document: node.doc,
    button_bar: { format: 'fixed' },
    ui_parameter_specifications: [{ oid: oid(node.seed + ':btn'), type: 'Button', value: node.button }],
    allow_back: node.allowBack,
    allow_stop: node.allowStop,
  }
  if (node.outputs) {
    // What this screen writes into the property store. A form block's
    // `outputParameter` is only a reference: without the matching declaration here
    // the step has no outputs, so Designer's Output Parameter dropdown is empty and
    // the step never appears in the SELECT 1 source picker, which lists the outputs
    // of every other step (hooks/useSourcePickerExtraGroups.ts). The answer is then
    // invisible to the branch even though the form collected it.
    step.output_parameter_specifications = node.outputs
  }
  if (node.images && node.images.length > 0) {
    // Maps each image block's imageOid to its filename in the package's images/
    // folder, which is how the runtime resolves the bytes.
    step.form_element_images = node.images.map((i) => ({ image_oid: i.imageOid, filename: i.filename }))
  }
  return step
}

function select1Step(node, question) {
  return {
    ...managed(node.localId, node.seed),
    step_type: 'SELECT 1',
    position: { ...ORIGIN },
    description: 'Which ' + question.noun + '?',
    select1_config: {
      input_name: questionOutputName(question),
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
export function buildWorkflow(recipe, photos = {}) {
  const slug = recipe.slug
  const seed = (s) => slug + ':' + s
  const steps = []
  const connections = []
  const report = { slug, name: recipe.name, screens: [], overflow: [], images: [] }

  // Step names. Designer labels a canvas node with the step's local_id
  // (lib/import/workflow-importers.ts: nodeData.label = step.local_id), and that same
  // label heads the step's group in the SELECT 1 source picker. A generated key like
  // `step-4` is no use to a reader there, so every step is named after the header
  // shown inside it — or, for the steps that have no form, after its description.
  //
  // local_id is free text in the schema (MissionEngine/src/spec/workflow-schema.json:
  // ManagedElement.local_id is a plain string) and the workflow's own local_id is
  // already the recipe name, so prose is fine here. Identity still comes from the
  // oid, which is seeded from the stable plan key, so renaming a step does not
  // renumber anything.
  const usedLabels = new Map()
  const label = (text) => {
    const base = String(text ?? '').replace(/\s+/g, ' ').trim() || 'Step'
    const n = (usedLabels.get(base) ?? 0) + 1
    usedLabels.set(base, n)
    return n === 1 ? base : base + ' (' + n + ')'
  }

  const startStep = { ...managed(label('Start'), seed('start')), step_type: 'START', position: { ...ORIGIN } }
  steps.push(startStep)

  // --- the linear plan of screens -----------------------------------------
  //
  // Two field names for the same two ideas, because a recipe and a facility procedure
  // are the same graph with different vocabulary. A recipe says `ingredients` and
  // `equipment`; anything else says `checklist` and `question`. Neither is required.
  const checklist = recipe.checklist ?? {
    title: 'What you need',
    items: recipe.ingredients ?? [],
    intro: recipe.serves ? 'Makes ' + recipe.serves + '.' : undefined,
  }
  const question = recipe.question ?? recipe.equipment ?? null

  const plan = []
  const pages = splitList(
    seed('ingredients'),
    checklist.title || 'What you need',
    checklist.items ?? [],
    checklist.intro,
  )
  pages.forEach((p, i) => {
    plan.push({
      kind: 'list',
      key: 'ingredients-' + (i + 1),
      title: p.title,
      lines: p.lines,
      intro: p.intro,
      only: null,
      track: null,
    })
  })
  if (question) {
    plan.push({ kind: 'question', key: 'equipment', title: question.prompt, only: null, track: null })
  }
  recipe.steps.forEach((s, i) => {
    plan.push({
      kind: 'step',
      key: 'step-' + (i + 1),
      step: s,
      title: s.title,
      only: s.only || null,
      track: s.track || null,
    })
  })

  // --- build the screen nodes ---------------------------------------------
  const nodes = plan.map((item, i) => {
    const isLast = i === plan.length - 1
    const key = item.key
    const s = seed(key)
    let doc
    const stepImages = []
    if (item.kind === 'list') doc = listScreen(s, item.title, item.lines, item.intro)
    else if (item.kind === 'question') doc = questionScreen(s, question)
    else doc = instructionScreen(s, item.step, photos, stepImages)
    for (const img of stepImages) report.images.push(img)

    const height = estimatePhoneHeight(doc)
    report.screens.push({ key, title: item.title, phoneHeight: height })
    if (height > PHONE.usableHeight) report.overflow.push({ key, title: item.title, phoneHeight: height })

    const override = item.kind === 'step' ? item.step : {}
    return {
      localId: label(item.title),
      seed: s,
      outputs:
        item.kind === 'question'
          ? [
              {
                id: questionOutputName(question),
                oid: oid(s + ':out'),
                description: 'The ' + question.noun + ' chosen on this screen.',
                // Kept identical to the id. See questionOutputName.
                target: questionOutputName(question),
              },
            ]
          : undefined,
      title: item.title,
      doc,
      images: stepImages,
      only: item.only,
      track: item.track,
      button: override.button || (isLast ? 'Done' : 'Next'),
      // Back is resolved while wiring, because whether it works depends on what
      // lies upstream in the finished graph, not on the step's position in the
      // spec. Stop is offered everywhere except the last screen.
      allowBackOverride: override.allowBack,
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

  // Back walks upstream for another screen, stopping at a barrier. START and the
  // join types are barriers (fixed-bar-checks.ts BARRIER_TYPES), so a screen placed
  // straight after one cannot offer Back.
  let backAvailable = false
  const setBack = (node) => {
    node.allowBack = node.allowBackOverride !== undefined ? node.allowBackOverride : backAvailable
  }

  /** Chain one run of screens, returning the open end. */
  const chainFrom = (start, list, startBack) => {
    let back = startBack
    let prev = start
    for (const n of list) {
      n.allowBack = n.allowBackOverride !== undefined ? n.allowBackOverride : back
      back = true
      const step = screenStep(n)
      steps.push(step)
      const c = { from_step_id: prev.oid, to_step_id: step.oid }
      if (prev.handle) {
        c.connection_id = prev.handle
        c.source_handle_id = prev.handle
      }
      connections.push(c)
      prev = { oid: step.oid, handle: null }
    }
    return prev
  }

  let i = 0
  let branchRound = 0
  let forkRound = 0
  while (i < nodes.length) {
    const node = nodes[i]

    // ---- a parallel region: consecutive steps that name a track ---------------
    if (node.track) {
      forkRound++
      const region = []
      while (i < nodes.length && nodes[i].track) {
        region.push(nodes[i])
        i++
      }

      // Tracks in first-appearance order, so the canvas reads in the order written.
      const trackNames = []
      for (const n of region) if (!trackNames.includes(n.track)) trackNames.push(n.track)

      const fork = {
        ...managed(label('Do these at the same time'), seed('fork-' + forkRound)),
        step_type: 'PARALLEL',
        position: { ...ORIGIN },
        description: trackNames.join(' / '),
      }
      steps.push(fork)
      connect(fork.oid)

      const join = {
        ...managed(label('All tracks complete'), seed('waitall-' + forkRound)),
        step_type: 'WAIT ALL',
        position: { ...ORIGIN },
        description: 'Hold until every track has finished',
      }

      const ends = trackNames.map((t) =>
        // PARALLEL is a barrier for Back (fixed-bar-checks.ts BARRIER_TYPES), so the
        // first screen of each track cannot offer it; later screens in the same track
        // go back within their own track, which is the only coherent target.
        chainFrom({ oid: fork.oid, handle: null }, region.filter((n) => n.track === t), false),
      )

      steps.push(join)
      for (const e of ends) connections.push({ from_step_id: e.oid, to_step_id: join.oid })
      pending = [{ oid: join.oid, handle: null }]
      // WAIT ALL is a barrier too.
      backAvailable = false
      continue
    }

    if (!node.only) {
      setBack(node)
      const step = screenStep(node)
      steps.push(step)
      connect(step.oid)
      pending = [{ oid: step.oid, handle: null }]
      backAvailable = true
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
      localId: label(question.selectLabel || 'Which ' + question.noun + '?'),
      seed: seed('select-' + branchRound),
    }
    const selStep = select1Step(sel, question)
    steps.push(selStep)
    connect(selStep.oid)

    const options = question.options
    const nextPending = []
    options.forEach((opt) => {
      const handle = oid(sel.seed + ':opt:' + opt.value)
      const mine = region.filter((n) => n.only.includes(opt.value))
      if (mine.length === 0) {
        // Nothing special for this equipment: fall straight through to the join.
        nextPending.push({ oid: selStep.oid, handle })
        return
      }
      // Each branch starts from the same upstream state: a SELECT 1 is not a
      // barrier, so the question screen before it is still a valid Back target.
      nextPending.push(chainFrom({ oid: selStep.oid, handle }, mine, backAvailable))
    })

    // Rejoin through a WAIT ANY. Without it the next shared step takes one inbound
    // edge per branch, which runs but reads badly on the canvas and gives Back an
    // ambiguous target.
    const join = {
      ...managed(label('Branches rejoin'), seed('join-' + branchRound)),
      step_type: 'WAIT ANY',
      position: { ...ORIGIN },
      description: 'Branches rejoin',
    }
    steps.push(join)
    for (const p of nextPending) {
      const c = { from_step_id: p.oid, to_step_id: join.oid }
      if (p.handle) {
        c.connection_id = p.handle
        c.source_handle_id = p.handle
      }
      connections.push(c)
    }
    pending = [{ oid: join.oid, handle: null }]
    // A join is a barrier for Back, so the next screen must not offer it.
    backAvailable = false
  }

  const endStep = { ...managed(label('End'), seed('end')), step_type: 'END', position: { ...ORIGIN } }
  steps.push(endStep)
  connect(endStep.oid)

  // Now that the graph is complete, let Designer's layout place every step.
  autoLayout(steps, connections)

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
  if (question) {
    spec.value_property_specifications = [
      {
        name: question.property,
        oid: oid(seed('prop:' + question.property)),
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
