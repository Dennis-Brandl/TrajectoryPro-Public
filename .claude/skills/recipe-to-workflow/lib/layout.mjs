// Step positions, using Mission Designer's own auto-layout.
//
// Designer lays a canvas out with dagre (src/hooks/useAutoLayout.ts). Rather than
// invent a second arrangement that would shift the moment someone presses Auto
// Layout in the editor, this runs the same algorithm with the same settings, so an
// imported recipe already sits where Designer would put it.
//
// Settings mirrored from useAutoLayout.ts, and checked against it by
// `node lib/check-layout-parity.mjs`:
//
//   rankdir  TB      flowchart and isa88 are top-to-bottom; only bpmn is LR
//   nodesep  30
//   ranksep  50
//   margin   10, 10
//   position centre rounded to the nearest 5, then offset to the top-left corner
//
// dagre is resolved from MissionCommander's node_modules rather than vendored, so
// this tracks whatever version the product builds against.

import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..', '..', '..')

/** Load dagre from a sibling app's install. */
function loadDagre() {
  const candidates = ['MissionDesigner', 'MissionCommander']
  const tried = []
  for (const app of candidates) {
    const anchor = path.join(repoRoot, app, 'package.json')
    try {
      return createRequire(anchor)('dagre')
    } catch (err) {
      tried.push(app + ' (' + err.code + ')')
    }
  }
  throw new Error(
    'could not load dagre from ' + tried.join(', ') + '.\n' +
      'Run `npm install` in MissionDesigner — this uses the same layout engine the editor does.',
  )
}

/**
 * Node box sizes, from getNodeDimensions() in useAutoLayout.ts for the flowchart
 * notation. Recipes export display_style "flowchart", so that is the table used.
 */
const FLOWCHART_SIZES = {
  start: { width: 30, height: 30 },
  end: { width: 30, height: 30 },
  catch: { width: 30, height: 30 },
  return: { width: 30, height: 30 },
  select1: { width: 60, height: 60 },
  waitAny: { width: 60, height: 60 },
  parallel: { width: 60, height: 60 },
  waitAll: { width: 60, height: 60 },
  gateStep: { width: 60, height: 60 },
  default: { width: 120, height: 50 },
}

/** Workflow step_type -> the internal node type Designer sizes by (type-mapping.ts). */
const STEP_TYPE_TO_NODE_TYPE = {
  START: 'start',
  END: 'end',
  'SELECT 1': 'select1',
  'WAIT ANY': 'waitAny',
  PARALLEL: 'parallel',
  'WAIT ALL': 'waitAll',
  GATE: 'gateStep',
  CATCH: 'catch',
  RETURN: 'return',
  USER_INTERACTION: 'userInteractionStep',
  YES_NO: 'yesNoStep',
  'ACTION PROXY': 'actionProxyWait',
  'WORKFLOW PROXY': 'workflowProxy',
  SCRIPT: 'scriptStep',
}

export function nodeDimensions(stepType) {
  const nodeType = STEP_TYPE_TO_NODE_TYPE[stepType] ?? 'default'
  return FLOWCHART_SIZES[nodeType] ?? FLOWCHART_SIZES.default
}

export const LAYOUT_SETTINGS = { rankdir: 'TB', nodesep: 30, ranksep: 50, marginx: 10, marginy: 10 }

/**
 * Assign `position` to every step, in place, the way Designer's Auto Layout would.
 *
 * Edges are keyed on step oid, matching the connections array.
 */
export function autoLayout(steps, connections) {
  const dagre = loadDagre()
  const g = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}))
  g.setGraph({ ...LAYOUT_SETTINGS })

  for (const step of steps) {
    const { width, height } = nodeDimensions(step.step_type)
    g.setNode(step.oid, { width, height })
  }
  for (const c of connections) {
    g.setEdge(c.from_step_id, c.to_step_id)
  }

  dagre.layout(g)

  for (const step of steps) {
    const pos = g.node(step.oid)
    const { width, height } = nodeDimensions(step.step_type)
    // Designer rounds the CENTRE to the nearest 5, then converts to a top-left
    // corner. Rounding after the offset would land half-pixels on odd sizes.
    const cx = Math.round(pos.x / 5) * 5
    const cy = Math.round(pos.y / 5) * 5
    step.position = { x: cx - width / 2, y: cy - height / 2 }
  }
  return steps
}
