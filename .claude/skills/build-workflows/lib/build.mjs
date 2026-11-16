#!/usr/bin/env node
// Build workflow specs into .WFmasterX runtime packages.
//
//   node lib/build.mjs                       # every spec in every source set
//   node lib/build.mjs roast-chicken         # one, by slug
//   node lib/build.mjs --set procedures      # only one source set
//   node lib/build.mjs --out ../elsewhere    # choose the output directory
//   node lib/build.mjs --json                # also write the bare .WFmaster JSON
//
// Two source sets, same builder and same spec shape:
//
//   recipes/*.recipe.json       -> examples/recipes/
//   procedures/*.procedure.json -> examples/procedures/
//
// A procedure is a recipe that says `checklist` instead of `ingredients` and
// `question` instead of `equipment`, and may fork steps into concurrent `track`s.
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
import { loadCredits, photoBytes } from './photos.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
// .claude/skills/build-workflows/lib -> up four is the repository root.
const repoRoot = path.resolve(root, '..', '..', '..')

// Packages land outside the skill, in gitignored folders that are easy to reach from
// Designer's and Commander's file pickers. They are build artefacts: the tracked
// source is the spec, and a rebuild reproduces them exactly.
const SETS = [
  { name: 'recipes', dir: 'recipes', suffix: '.recipe.json', out: ['examples', 'recipes'] },
  { name: 'procedures', dir: 'procedures', suffix: '.procedure.json', out: ['examples', 'procedures'] },
]

const args = process.argv.slice(2)
let outOverride = null
let alsoJson = false
let setFilter = null
const wanted = []
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out') outOverride = path.resolve(args[++i])
  else if (args[i] === '--set') setFilter = args[++i]
  else if (args[i] === '--json') alsoJson = true
  else wanted.push(args[i])
}

const jobs = []
for (const set of SETS) {
  if (setFilter && set.name !== setFilter) continue
  const dir = path.join(root, set.dir)
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    continue // a source set that does not exist yet is not an error
  }
  for (const file of entries.filter((f) => f.endsWith(set.suffix)).sort()) {
    const slug = file.replace(set.suffix, '')
    if (wanted.length > 0 && !wanted.includes(slug)) continue
    jobs.push({ set, file, slug, dir, outDir: outOverride ?? path.join(repoRoot, ...set.out) })
  }
}

if (jobs.length === 0) {
  console.error('no specs matched' + (wanted.length ? ': ' + wanted.join(', ') : ''))
  process.exit(1)
}

for (const d of new Set(jobs.map((j) => j.outDir))) mkdirSync(d, { recursive: true })

const credits = loadCredits()
let overflowing = 0

for (const job of jobs) {
  const { file, dir: recipeDir, outDir } = job
  const recipe = JSON.parse(readFileSync(path.join(recipeDir, file), 'utf8'))
  recipe.slug = recipe.slug || job.slug
  const { spec, report } = buildWorkflow(recipe, credits)

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

  // images/{imageOid}-{filename}, the shape Designer's packager writes and both
  // importers resolve. The same photo used on two steps gets one entry per block,
  // because each block's imageOid is its own key.
  const imageEntries = []
  for (const img of report.images) {
    const zipPath = 'images/' + img.imageOid + '-' + img.filename
    if (imageEntries.some((e) => e.name === zipPath)) continue
    const entry = Object.values(credits).find((c) => c.filename === img.filename)
    if (!entry) throw new Error('no cached photo for ' + img.filename + ' — run lib/fetch-photos.mjs')
    imageEntries.push({ name: zipPath, data: photoBytes(entry) })
  }
  manifest.files.push(...imageEntries.map((e) => ({ path: e.name, type: 'image' })))

  const zip = zipSync([
    { name: masterEntry, data: masterJson },
    ...imageEntries,
    { name: 'manifest.json', data: JSON.stringify(manifest, null, 2) },
  ])

  const packageName = withVersionSuffix(recipe.name, spec.version) + '.WFmasterX'
  writeFileSync(path.join(outDir, packageName), zip)
  if (alsoJson) writeFileSync(path.join(outDir, masterEntry), masterJson + '\n')

  const tallest = report.screens.reduce((a, b) => (b.phoneHeight > a.phoneHeight ? b : a), report.screens[0])
  const branches = spec.steps.filter((s) => s.step_type === 'SELECT 1').length
  const forks = spec.steps.filter((s) => s.step_type === 'PARALLEL').length
  console.log(
    [
      recipe.slug.padEnd(20),
      String(report.screens.length).padStart(2) + ' screens',
      String(report.stepCount).padStart(2) + ' steps',
      String(report.connectionCount).padStart(2) + ' edges',
      branches + ' branch' + (branches === 1 ? ' ' : 'es'),
      forks + ' fork' + (forks === 1 ? ' ' : 's'),
      'phone ' + String(tallest.phoneHeight).padStart(3) + '/' + PHONE.usableHeight,
      String(report.images.length).padStart(2) + ' photo' + (report.images.length === 1 ? ' ' : 's'),
      String(Math.round(zip.length / 1024)).padStart(4) + ' KB',
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
for (const d of [...new Set(jobs.map((j) => j.outDir))].sort()) {
  console.log('wrote ' + jobs.filter((j) => j.outDir === d).length + ' package(s) to ' + d)
}

if (overflowing > 0) {
  console.error('')
  console.error(overflowing + ' screen(s) overflow the phone budget — split the step or shorten the text.')
  process.exit(1)
}
