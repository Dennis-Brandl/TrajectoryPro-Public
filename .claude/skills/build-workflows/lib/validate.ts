// Validate generated .WFmasterX packages against Mission Designer's OWN validators.
//
// This deliberately re-implements no checking. It opens each package with the same
// ZIP reader the product uses and calls the same validators, so a package that
// passes here is one Designer accepts — not one that matches this skill's reading
// of the schema.
//
//   1. package shape        exactly one root .WFmaster, no stray entries (§2.2)
//   2. validateWorkflowSpecification   the workflow JSON schema
//   3. validateFormDocument            the Form Document v2 schema, per screen
//   4. the form-schema authoring checks (hidden required fields, duplicate option
//      values, buttons with no job, a step with no way out)
//   5. graph checks         every SELECT 1 option routed, nothing stranded, no
//                           fan-in outside a join
//   6. branch data          every form binding names an output parameter its step
//                           declares, and every SELECT 1 reads a key some upstream
//                           step actually writes
//   7. importWorkflow       the real importer, which is the actual gate
//
// It must run from MissionDesigner so the `@/` alias and the workspace packages
// resolve, and with NODE_PATH pointing at MissionDesigner's node_modules because
// this file lives outside that package:
//
//   cd MissionDesigner
//   NODE_PATH=./node_modules npx tsx ../.claude/skills/build-workflows/lib/validate.ts
//
// With no argument it reads the build's default output directory, examples/recipes/ at
// the repository root. Pass a directory to check packages built somewhere else.

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'
import { validateWorkflowSpecification } from '@/lib/import/schema-validator'
import { importWorkflow } from '@/lib/import/workflow-importers'
import { collectFixedBarWarnings } from '@/lib/export/fixed-bar-checks'
import {
  validateFormDocument,
  findHiddenRequired,
  findDuplicateOptionValues,
  checkNeverStuck,
  checkJoblessButtons,
  type FormDocument,
} from '@mission/form-schema'

async function main() {
  // lib/ -> up four is the repository root, matching lib/build.mjs's default.
  const defaultDir = path.join(__dirname, '..', '..', '..', '..', 'examples', 'recipes')
  const dir = path.resolve(process.argv[2] ?? defaultDir)
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.WFmasterX'))
    .sort()

  let failures = 0
  const fail = (where: string, message: string) => {
    failures++
    console.error('  FAIL  ' + where + ': ' + message)
  }

  /** Entry paths a .WFmasterX importer accepts; anything else is zip_filename_invalid. */
  const allowed = (p: string) =>
    p === 'manifest.json' ||
    p.endsWith('.WFmaster') ||
    p.startsWith('images/') ||
    p.startsWith('environments/') ||
    p.startsWith('actions/')

  for (const file of files) {
    console.log('\n' + file)
    const zip = await JSZip.loadAsync(readFileSync(path.join(dir, file)))
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir)

    const masters = names.filter((n) => n.endsWith('.WFmaster') && !n.includes('/'))
    if (masters.length !== 1) {
      fail(file, 'expected exactly one root .WFmaster, found ' + masters.length + ': ' + names.join(', '))
      continue
    }
    const stray = names.filter((n) => !allowed(n))
    if (stray.length > 0) fail(file, 'entries the importer rejects: ' + stray.join(', '))
    console.log('  package     OK  (' + names.length + ' entries: ' + names.join(', ') + ')')

    const spec = JSON.parse(await zip.files[masters[0]].async('string'))

    const res = validateWorkflowSpecification(spec)
    if (!res.success) {
      fail('workflow schema', JSON.stringify(res.errors).slice(0, 600))
      continue
    }
    console.log('  schema      OK  (schemaVersion ' + spec.schemaVersion + ')')

    const screens = spec.steps.filter((s: { form_document?: unknown }) => s.form_document)
    let docProblems = 0

    for (const step of screens) {
      const doc = step.form_document as FormDocument
      const where = spec.local_id + ' / ' + step.local_id

      // The result field is `ok`, not `valid`. Reading the wrong one reports every
      // document as broken with an empty error list.
      const v = validateFormDocument(doc)
      if (!v.ok) {
        fail(where, 'form document: ' + JSON.stringify(v.errors).slice(0, 400))
        docProblems++
        continue
      }

      // A recipe screen is always a plain Continue step; a Yes/No step would be
      // 'yesno' and would need job buttons.
      const kind = 'continue' as const
      for (const p of findHiddenRequired(doc)) fail(where, 'hidden required: ' + p.message)
      for (const p of findDuplicateOptionValues(doc)) fail(where, 'duplicate option: ' + p.message)
      for (const p of checkJoblessButtons(doc, kind)) fail(where, 'jobless button: ' + p.message)

      // checkNeverStuck only applies to steps whose buttons live IN the form. These
      // steps use the fixed button bar, so the bar supplies the way out and the form
      // legitimately has none. Run it only if a form ever grows its own buttons.
      const hasOwnButtons = doc.sections.some((s) => s.rows.some((r) => r.blocks.some((b) => b.type === 'button')))
      if (hasOwnButtons) for (const p of checkNeverStuck(doc, kind)) fail(where, 'never stuck: ' + p.message)
    }
    if (docProblems === 0) console.log('  forms       OK  (' + screens.length + ' screens)')

    // Only a join may take more than one inbound edge. Anything else with a fan-in
    // means branches were merged by running several edges into an ordinary step
    // instead of rejoining through a WAIT ANY.
    const JOINS = new Set(['WAIT ANY', 'WAIT ALL'])
    const inbound = new Map<string, number>()
    for (const c of spec.connections) inbound.set(c.to_step_id, (inbound.get(c.to_step_id) ?? 0) + 1)
    for (const step of spec.steps) {
      const n = inbound.get(step.oid) ?? 0
      if (n > 1 && !JOINS.has(step.step_type)) {
        fail(
          spec.local_id,
          step.local_id + ' (' + step.step_type + ') has ' + n + ' inbound edges — branches should rejoin through a WAIT ANY',
        )
      }
    }
    const joins = spec.steps.filter((s: { step_type: string }) => JOINS.has(s.step_type)).length
    const backs = screens.filter((s: { allow_back?: boolean }) => s.allow_back).length
    const stops = screens.filter((s: { allow_stop?: boolean }) => s.allow_stop).length
    console.log('  buttons     OK  (Back on ' + backs + '/' + screens.length + ', Stop on ' + stops + ')')

    // ---- the branch input has to be something a step actually writes ----------
    //
    // A SELECT 1 reads one key out of the property store
    // (MissionEngine/src/core/step-handlers.ts). Nothing writes that key unless some
    // step upstream declares an output parameter whose `target` is it AND a form block
    // on that step binds to it by name. Miss either half and the branch still imports,
    // still looks right on the canvas, and silently takes its default option on every
    // run — which is exactly the defect this check exists to catch.

    /** Every block in a form document, flattened. */
    const blocksOf = (doc: FormDocument) =>
      doc.sections.flatMap((sec) => sec.rows.flatMap((r) => r.blocks as Array<Record<string, unknown>>))

    type OutSpec = { id: string; target?: string }
    const outputsOf = (step: { output_parameter_specifications?: OutSpec[] }) =>
      step.output_parameter_specifications ?? []

    // (a) a block's outputParameter must name an output parameter its own step declares.
    //     Designer's Parameter Binding dropdown is populated from the step's outputs, so
    //     a binding to an undeclared name shows up as an empty Output Parameter field.
    for (const step of screens) {
      const declared = new Set(outputsOf(step).map((o) => o.id))
      for (const block of blocksOf(step.form_document as FormDocument)) {
        const bound = block['outputParameter']
        if (typeof bound !== 'string' || bound === '') continue
        if (!declared.has(bound)) {
          fail(
            spec.local_id + ' / ' + step.local_id,
            'block binds outputParameter "' + bound + '" but the step declares ' +
              (declared.size === 0
                ? 'no output parameters — Designer will show the binding as empty'
                : 'only: ' + [...declared].join(', ')),
          )
        }
      }
    }

    // (b) the key each SELECT 1 reads must be written by a step that can reach it.
    const writers = new Map<string, string[]>() // property key -> step local_ids writing it
    for (const step of screens) {
      const bound = new Set(
        blocksOf(step.form_document as FormDocument)
          .map((b) => b['outputParameter'])
          .filter((v): v is string => typeof v === 'string' && v !== ''),
      )
      for (const out of outputsOf(step)) {
        if (!bound.has(out.id)) continue // declared but nothing fills it
        const key = out.target || out.id
        writers.set(key, (writers.get(key) ?? []).concat(step.local_id))
      }
    }

    // Reachability over the directed graph, so "upstream" means upstream and not
    // merely "somewhere in the file".
    const outEdges = new Map<string, string[]>()
    for (const c of spec.connections) {
      outEdges.set(c.from_step_id, (outEdges.get(c.from_step_id) ?? []).concat(c.to_step_id))
    }
    const byLocalId = new Map<string, string>(spec.steps.map((st: { local_id: string; oid: string }) => [st.local_id, st.oid]))
    const canReach = (fromOid: string, targetOid: string) => {
      const seen = new Set([fromOid])
      const queue = [fromOid]
      while (queue.length > 0) {
        const cur = queue.shift() as string
        for (const next of outEdges.get(cur) ?? []) {
          if (next === targetOid) return true
          if (seen.has(next)) continue
          seen.add(next)
          queue.push(next)
        }
      }
      return false
    }

    // Every SELECT 1 option needs an edge, or that choice dead-ends.
    const select1s = spec.steps.filter((s: { step_type: string }) => s.step_type === 'SELECT 1')
    for (const step of select1s) {
      const cfg = step.select1_config
      if (cfg.input_value_type !== 'property') {
        fail(spec.local_id, step.local_id + ': input_value_type is "' + cfg.input_value_type + '", so input_name is compared as a literal and the branch is fixed')
      } else {
        const key = cfg.input_name
        const found = writers.get(key) ?? []
        const upstream = found.filter((localId) => canReach(byLocalId.get(localId) as string, step.oid))
        if (found.length === 0) {
          fail(
            spec.local_id,
            step.local_id + ' branches on "' + key + '", which no step writes — ' +
              'declare it as an output parameter (target "' + key + '") on the step whose form collects it. ' +
              (writers.size > 0 ? 'Written elsewhere: ' + [...writers.keys()].join(', ') : 'This workflow writes nothing at all.'),
          )
        } else if (upstream.length === 0) {
          fail(
            spec.local_id,
            step.local_id + ' branches on "' + key + '", written only by ' + found.join(', ') +
              ', which cannot reach it — the value is unset when the branch is evaluated',
          )
        }
      }
    }
    for (const step of select1s) {
      const edges = spec.connections.filter((c: { from_step_id: string }) => c.from_step_id === step.oid)
      for (const opt of step.select1_config.options) {
        if (!edges.some((e: { source_handle_id?: string }) => e.source_handle_id === opt.id)) {
          fail(spec.local_id, 'SELECT 1 option "' + opt.label + '" has no outgoing edge')
        }
      }
    }

    // Nothing stranded: every step but END leads somewhere, every step but START is reachable.
    const from = new Set(spec.connections.map((c: { from_step_id: string }) => c.from_step_id))
    const to = new Set(spec.connections.map((c: { to_step_id: string }) => c.to_step_id))
    for (const step of spec.steps) {
      if (step.step_type !== 'END' && !from.has(step.oid)) fail(spec.local_id, step.local_id + ' leads nowhere')
      if (step.step_type !== 'START' && !to.has(step.oid)) fail(spec.local_id, step.local_id + ' is unreachable')
    }
    if (select1s.length > 0) {
      console.log('  branching   OK  (' + select1s.length + ' SELECT 1, ' + joins + ' join)')
    }

    const imported = importWorkflow(spec)
    if ('error' in imported) {
      fail(spec.local_id, 'importer rejected it: ' + JSON.stringify(imported).slice(0, 500))
    } else {
      const { nodes, edges } = imported as { nodes: never[]; edges: never[] }
      console.log('  import      OK  (' + nodes.length + ' nodes)')

      // Designer's own rule, run on Designer's own graph: a screen that offers Back
      // with no screen upstream — START and the join types are barriers — warns
      // "Back will never be available here".
      const warnings = collectFixedBarWarnings(nodes, edges)
      for (const w of warnings) fail(spec.local_id, 'fixed bar: ' + w)
      if (warnings.length === 0) console.log('  back/stop   OK  (Designer fixed-bar checks clean)')
    }
  }

  console.log('')
  if (failures > 0) {
    console.error(failures + ' problem(s) found.')
    process.exit(1)
  }
  console.log('All ' + files.length + ' package(s) passed every Designer validator.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
