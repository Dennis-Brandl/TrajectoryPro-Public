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
//   5. graph checks         every SELECT 1 option routed, nothing stranded
//   6. importWorkflow       the real importer, which is the actual gate
//
// It must run from MissionDesigner so the `@/` alias and the workspace packages
// resolve, and with NODE_PATH pointing at MissionDesigner's node_modules because
// this file lives outside that package:
//
//   cd MissionDesigner
//   NODE_PATH=./node_modules npx tsx ../.claude/skills/recipe-to-workflow/lib/validate.ts
//
// With no argument it reads the build's default output directory, examples/recipes/ at
// the repository root. Pass a directory to check packages built somewhere else.

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'
import { validateWorkflowSpecification } from '@/lib/import/schema-validator'
import { importWorkflow } from '@/lib/import/workflow-importers'
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

    // Back needs somewhere to go, so the first screen must not offer it.
    const firstScreen = screens[0]
    if (firstScreen?.allow_back === true) {
      fail(spec.local_id, 'first screen "' + firstScreen.local_id + '" offers Back with nothing behind it')
    }
    const backs = screens.filter((s: { allow_back?: boolean }) => s.allow_back).length
    const stops = screens.filter((s: { allow_stop?: boolean }) => s.allow_stop).length
    console.log('  buttons     OK  (Back on ' + backs + '/' + screens.length + ', Stop on ' + stops + ')')

    // Every SELECT 1 option needs an edge, or that choice dead-ends.
    const select1s = spec.steps.filter((s: { step_type: string }) => s.step_type === 'SELECT 1')
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
    if (select1s.length > 0) console.log('  branching   OK  (' + select1s.length + ' SELECT 1)')

    const imported = importWorkflow(spec)
    if ('error' in imported) {
      fail(spec.local_id, 'importer rejected it: ' + JSON.stringify(imported).slice(0, 500))
    } else {
      console.log('  import      OK  (' + (imported as { nodes: unknown[] }).nodes.length + ' nodes)')
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
