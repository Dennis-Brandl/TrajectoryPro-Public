#!/usr/bin/env node
// Fetch every photo the recipe specs reference, with a licence check on each.
//
//   node lib/fetch-photos.mjs                 # all recipes
//   node lib/fetch-photos.mjs fish-chowder    # one
//   node lib/fetch-photos.mjs --check         # verify the cache, download nothing
//
// Run this before `node lib/build.mjs` when a recipe gains or changes a photo.
// Downloads land in photos/ (gitignored) and provenance in photos/credits.json
// (tracked). A file whose licence is not public domain, CC0 or plain CC BY is
// refused by name rather than quietly skipped.

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchPhoto, loadCredits, saveCredits, creditLine, PHOTO_DIR } from './photos.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const recipeDir = path.join(root, 'recipes')

const args = process.argv.slice(2)
const checkOnly = args.includes('--check')
const wanted = args.filter((a) => !a.startsWith('--'))

const files = readdirSync(recipeDir)
  .filter((f) => f.endsWith('.recipe.json'))
  .filter((f) => wanted.length === 0 || wanted.includes(f.replace('.recipe.json', '')))
  .sort()

/** Every photo title any selected recipe asks for, in first-seen order. */
const titles = []
for (const file of files) {
  const recipe = JSON.parse(readFileSync(path.join(recipeDir, file), 'utf8'))
  for (const step of recipe.steps ?? []) {
    if (step.photo && !titles.includes(step.photo)) titles.push(step.photo)
  }
  if (recipe.equipment?.photo && !titles.includes(recipe.equipment.photo)) titles.push(recipe.equipment.photo)
}

if (titles.length === 0) {
  console.log('no photos referenced by ' + files.length + ' recipe(s) — nothing to do')
  process.exit(0)
}

const credits = loadCredits()
let failures = 0

if (checkOnly) {
  for (const title of titles) {
    const entry = credits[title]
    if (!entry) {
      failures++
      console.error('  MISSING  ' + title + ' is referenced but not in credits.json')
      continue
    }
    const file = path.join(PHOTO_DIR, entry.filename)
    if (!existsSync(file)) {
      failures++
      console.error('  ABSENT   ' + entry.filename + ' — run without --check to fetch it')
      continue
    }
    const sha256 = createHash('sha256').update(readFileSync(file)).digest('hex')
    if (sha256 !== entry.sha256) {
      failures++
      console.error('  CHANGED  ' + entry.filename + ' does not match its recorded hash')
      continue
    }
    console.log('  ok  ' + entry.filename.padEnd(46) + entry.licence)
  }
} else {
  for (const title of titles) {
    try {
      const entry = await fetchPhoto(title, credits)
      credits[title] = entry
      console.log(
        '  ' + (entry.cached ? 'cached ' : 'fetched') + '  ' +
          entry.filename.padEnd(46) +
          entry.licence.padEnd(16) +
          String(Math.round(entry.bytes / 1024)).padStart(4) + ' KB',
      )
      console.log('            ' + creditLine(entry))
    } catch (err) {
      failures++
      console.error('  REFUSED  ' + err.message)
    }
  }
  saveCredits(credits)
}

console.log('')
if (failures > 0) {
  console.error(failures + ' photo problem(s).')
  process.exit(1)
}
console.log(titles.length + ' photo(s) ready. Provenance in photos/credits.json')
