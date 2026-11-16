// Check lib/layout.mjs against Mission Designer's real auto-layout.
//
// layout.mjs mirrors useAutoLayout.ts rather than importing it, because that file is
// a React hook and its layout function is not exported. A mirror can drift, so this
// compares the two directly:
//
//   1. the node box table, against Designer's exported getNodeDimensions()
//   2. the finished positions, against dagre driven with Designer's own settings
//
// Run from MissionDesigner:
//   NODE_PATH=./node_modules npx tsx ../.claude/skills/recipe-to-workflow/lib/check-layout-parity.ts

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'
import dagre from 'dagre'
import { getNodeDimensions } from '@/hooks/useAutoLayout'
import type { NodeType } from '@/types/nodes'
import { nodeDimensions, LAYOUT_SETTINGS } from './layout.mjs'

const STEP_TYPE_TO_NODE_TYPE: Record<string, NodeType> = {
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

let failures = 0
const fail = (m: string) => {
  failures++
  console.error('  FAIL  ' + m)
}

async function main() {
  console.log('1. node box sizes vs Designer getNodeDimensions(flowchart)')
  for (const [stepType, nodeType] of Object.entries(STEP_TYPE_TO_NODE_TYPE)) {
    const theirs = getNodeDimensions(nodeType, 'flowchart')
    const mine = nodeDimensions(stepType)
    if (theirs.width !== mine.width || theirs.height !== mine.height) {
      fail(
        stepType + ' (' + nodeType + '): designer ' + theirs.width + 'x' + theirs.height +
          ', layout.mjs ' + mine.width + 'x' + mine.height,
      )
    }
  }
  if (failures === 0) console.log('   OK  all ' + Object.keys(STEP_TYPE_TO_NODE_TYPE).length + ' step types match')

  console.log('\n2. finished positions vs dagre run with Designer settings')
  const dir = path.join(__dirname, '..', '..', '..', '..', 'examples', 'recipes')
  const files = readdirSync(dir).filter((f) => f.endsWith('.WFmasterX')).sort()

  for (const file of files) {
    const zip = await JSZip.loadAsync(readFileSync(path.join(dir, file)))
    const name = Object.keys(zip.files).find((n) => n.endsWith('.WFmaster'))!
    const spec = JSON.parse(await zip.files[name].async('string'))

    // Re-run the layout exactly as useAutoLayout.ts does it.
    const g = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}))
    g.setGraph({ rankdir: 'TB', nodesep: 30, ranksep: 50, marginx: 10, marginy: 10 })
    for (const s of spec.steps) {
      const d = getNodeDimensions(STEP_TYPE_TO_NODE_TYPE[s.step_type], 'flowchart')
      g.setNode(s.oid, { width: d.width, height: d.height })
    }
    for (const c of spec.connections) g.setEdge(c.from_step_id, c.to_step_id)
    dagre.layout(g)

    let drift = 0
    for (const s of spec.steps) {
      const p = g.node(s.oid)
      const d = getNodeDimensions(STEP_TYPE_TO_NODE_TYPE[s.step_type], 'flowchart')
      const want = { x: Math.round(p.x / 5) * 5 - d.width / 2, y: Math.round(p.y / 5) * 5 - d.height / 2 }
      if (s.position.x !== want.x || s.position.y !== want.y) {
        drift++
        if (drift <= 3) {
          fail(
            file + ' / ' + s.local_id + ': package (' + s.position.x + ',' + s.position.y +
              ') vs designer (' + want.x + ',' + want.y + ')',
          )
        }
      }
    }
    if (drift === 0) console.log('   OK  ' + file.padEnd(38) + spec.steps.length + ' steps identical')
    else fail(file + ': ' + drift + ' step(s) differ')
  }

  const settings = JSON.stringify(LAYOUT_SETTINGS)
  console.log('\n   settings used: ' + settings)

  if (failures > 0) {
    console.error('\n' + failures + ' parity problem(s). layout.mjs has drifted from useAutoLayout.ts.')
    process.exit(1)
  }
  console.log('\nlayout.mjs matches Mission Designer exactly.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
