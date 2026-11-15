#!/usr/bin/env node
// Build recipe specs into .WFmasterX runtime packages.
//
//   node lib/build.mjs                       # every recipes/*.recipe.json
//   node lib/build.mjs roast-chicken         # one, by slug
//   node lib/build.mjs --out ../elsewhere    # choose the output directory
//   node lib/build.mjs --json                # also write the bare .WFmaster JSON
//
// A .WFmasterX is the format Mission Commander loads (docs/JSON_SCHEMA.md §2.2):
// a ZIP holding exactly one root-level .WFmaster — the bare
// MasterWorkflowSpecification — plus an advisory manifest.json.
//
// Recipes use no environment actions, so no environments/ or actions/ entries
// are written, and the line-art drawings stay inline as data URIs rather than
// becoming images/ entries: Designer's own packager skips data URIs when it
// collects form images (MissionDesigner/src/lib/packageFormat/image-collectors.ts),
// so inline is the shape it already expects to pass through untouched.
//
// Exits non-zero if any screen overflows the phone budget, so a recipe that has
// grown too wordy for a phone fails the build instead of shipping.

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildWorkflow } from './build-workflow.mjs'
import { PHONE } from './build-forms.mjs'
import { zipSync, sanitizeName, withVersionSuffix } from './zip.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
// .claude/skills/recipe-to-workflow/lib -> up four is the repository root.
const repoRoot = path.resolve(root, '..', '..', '..')

const args = process.argv.slice(2)
// Packages land outside the skill, in a gitignored folder that is easy to reach
// from Designer's and Commander's file pickers. They are build artefacts: the
// tracked source is recipes/*.recipe.json, and a rebuild reproduces them exactly.
let outDir = path.join(repoRoot, 'examples', 'recipes')
let alsoJson = false
const wanted = []
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out') outDir = path.resolve(args[++i])
  else if (args[i] === '--json') alsoJson = true
  else wanted.push(args[i])
}

const recipeDir = path.join(root, 'recipes')
const files = readdirSync(recipeDir)
  .filter((f) => f.endsWith('.recipe.json'))
  .filter((f) => wanted.length === 0 || wanted.includes(f.replace('.recipe.json', '')))
  .sort()

if (files.length === 0) {
  console.error('no recipe specs matched' + (wanted.length ? ': ' + wanted.join(', ') : ''))
  process.exit(1)
}

mkdirSync(outDir, { recursive: true })

let overflowing = 0

for (const file of files) {
  const recipe = JSON.parse(readFileSync(path.join(recipeDir, file), 'utf8'))
  recipe.slug = recipe.slug || file.replace('.recipe.json', '')
  const { spec, report } = buildWorkflow(recipe)

  const safeName = sanitizeName(recipe.name)
  const masterEntry = safeName + '.WFmaster'
  const masterJson = JSON.stringify(spec, null, 2)

  const manifest = {
    packageVersion: '1.0',
    workflowName: recipe.name,
    environmentLibraries: [],
    actionLibraries: [],
    // Fixed, not `new Date()`: a rebuild of an unchanged recipe should produce an
    // identical package rather than a diff that is only a timestamp.
    createdAt: spec.last_modified_date,
    files: [{ path: masterEntry, type: 'workflow' }],
  }

  const zip = zipSync([
    { name: masterEntry, data: masterJson },
    { name: 'manifest.json', data: JSON.stringify(manifest, null, 2) },
  ])

  const packageName = withVersionSuffix(recipe.name, spec.version) + '.WFmasterX'
  writeFileSync(path.join(outDir, packageName), zip)
  if (alsoJson) writeFileSync(path.join(outDir, masterEntry), masterJson + '\n')

  const tallest = report.screens.reduce((a, b) => (b.phoneHeight > a.phoneHeight ? b : a), report.screens[0])
  const branches = spec.steps.filter((s) => s.step_type === 'SELECT 1').length
  console.log(
    [
      recipe.slug.padEnd(20),
      String(report.screens.length).padStart(2) + ' screens',
      String(report.stepCount).padStart(2) + ' steps',
      String(report.connectionCount).padStart(2) + ' edges',
      branches + ' branch' + (branches === 1 ? ' ' : 'es'),
      'phone ' + String(tallest.phoneHeight).padStart(3) + '/' + PHONE.usableHeight,
      String(Math.round(zip.length / 1024)).padStart(3) + ' KB',
      packageName,
    ].join('  '),
  )

  for (const o of report.overflow) {
    overflowing++
    console.error(
      '   OVERFLOW  ' + o.key + ' "' + o.title + '" needs ' + o.phoneHeight + 'px, budget is ' + PHONE.usableHeight,
    )
  }
}

console.log('')
console.log('wrote ' + files.length + ' package(s) to ' + outDir)

if (overflowing > 0) {
  console.error('')
  console.error(overflowing + ' screen(s) overflow the phone budget — split the step or shorten the text.')
  process.exit(1)
}
