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
 * Generates a "Spaghetti Bolognese Dinner" workflow as a .WFmasterX ZIP file
 * importable via the Mission Designer Import Workflow button.
 *
 * Features:
 *   - USER_INTERACTION steps with WYSIWYG form_layout_config (header, image, text, button)
 *   - YES_NO decision steps for optional wine and seasoning adjustment
 *   - PARALLEL + WAIT ALL for concurrent tasks optimized for a single cook
 *   - WAIT ANY for rejoining yes/no branches
 *   - Pexels free stock images embedded in the ZIP
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const JSZip = require('jszip')

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, '..', 'test-data')

let _oidCounter = 5000000000000
function oid() {
  return String(++_oidCounter)
}
function isoNow() {
  return new Date().toISOString()
}

// ─── Image Download ──────────────────────────────────────────────────────────

const PEXELS_IMAGES = {
  'ingredients.jpg': 2720445,
  'prep-vegetables.jpg': 128391,
  'boil-water.jpg': 12673645,
  'brown-meat.jpg': 3298605,
  'soffritto.jpg': 8629109,
  'garlic-paste.jpg': 8175436,
  'wine.jpg': 2838588,
  'tomatoes-herbs.jpg': 1373915,
  'simmer-sauce.jpg': 6287472,
  'cook-pasta.jpg': 6287466,
  'combine.jpg': 6287520,
  'plate-serve.jpg': 6287525,
}

function pexelsUrl(photoId) {
  return `https://images.pexels.com/photos/${photoId}/pexels-photo-${photoId}.jpeg?auto=compress&cs=tinysrgb&w=600`
}

async function downloadImage(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

// ─── Step & Connection Builders ──────────────────────────────────────────────

function step(localId, stepType, extras = {}) {
  return {
    local_id: localId,
    oid: oid(),
    version: '1.0.0',
    last_modified_date: isoNow(),
    step_type: stepType,
    ...extras,
  }
}

function conn(fromOid, toOid, extras = {}) {
  return { from_step_id: fromOid, to_step_id: toOid, connection_id: oid(), ...extras }
}

// ─── Form Layout Builder ─────────────────────────────────────────────────────
//
// Phone canvas: 390 x 844.  Top chrome zone = 15% (~127 px).
// Content area: x=20..370  (350 px wide), y=130..800

/**
 * Build a phone form layout for an instruction step.
 * Elements: header, optional image, body text lines, optional tip, Done button.
 */
function buildPhoneLayout({ title, image, bodyLines, tip }) {
  const elements = []
  let y = 130

  // Header
  elements.push({
    type: 'header',
    x: 20,
    y,
    width: 350,
    height: 36,
    content: title,
    fontSize: 22,
    fontWeight: 'bold',
    align: 'center',
  })
  y += 46

  // Image (if present)
  if (image) {
    elements.push({
      type: 'image',
      x: 20,
      y,
      width: 350,
      height: 220,
      src: image,
      objectFit: 'cover',
    })
    y += 230
  }

  // Divider after image or header
  elements.push({
    type: 'divider',
    x: 20,
    y,
    width: 350,
    height: 2,
    thickness: 1,
    color: '#e2e8f0',
  })
  y += 12

  // Body text lines
  const bodyText = bodyLines.join('\n')
  const lineCount = bodyLines.length
  const textHeight = Math.max(60, lineCount * 22 + 10)
  elements.push({
    type: 'text',
    x: 20,
    y,
    width: 350,
    height: textHeight,
    content: bodyText,
    fontSize: 15,
  })
  y += textHeight + 10

  // Tip (if present)
  if (tip) {
    const tipHeight = Math.max(40, Math.ceil(tip.length / 45) * 18 + 10)
    elements.push({
      type: 'text',
      x: 20,
      y,
      width: 350,
      height: tipHeight,
      content: tip,
      fontSize: 13,
      color: '#555555',
    })
    y += tipHeight + 10
  }

  // Done button — within the usable area (phone usableBottom=760, button height=44)
  // Must stay at or above y=716 so bottom edge is at y=760 (chrome zone boundary)
  const buttonY = Math.min(Math.max(y + 20, 680), 700)
  elements.push({
    type: 'button',
    x: 95,
    y: buttonY,
    width: 200,
    height: 44,
    label: 'Done',
    outputValue: 'continue',
  })

  return [{ deviceType: 'phone', canvasWidth: 390, canvasHeight: 844, elements }]
}

/**
 * Build a phone form layout for a YES_NO step.
 * Elements: header, optional image, question text, yes/no buttons.
 */
function buildYesNoLayout({ title, image, questionLines, tip, yesLabel, noLabel }) {
  const elements = []
  let y = 130

  // Header
  elements.push({
    type: 'header',
    x: 20,
    y,
    width: 350,
    height: 36,
    content: title,
    fontSize: 22,
    fontWeight: 'bold',
    align: 'center',
  })
  y += 46

  // Image (if present)
  if (image) {
    elements.push({
      type: 'image',
      x: 20,
      y,
      width: 350,
      height: 220,
      src: image,
      objectFit: 'cover',
    })
    y += 230
  }

  // Divider
  elements.push({
    type: 'divider',
    x: 20,
    y,
    width: 350,
    height: 2,
    thickness: 1,
    color: '#e2e8f0',
  })
  y += 12

  // Question text
  const qText = questionLines.join('\n')
  const qHeight = Math.max(60, questionLines.length * 22 + 10)
  elements.push({
    type: 'text',
    x: 20,
    y,
    width: 350,
    height: qHeight,
    content: qText,
    fontSize: 15,
  })
  y += qHeight + 10

  // Tip (if present)
  if (tip) {
    elements.push({
      type: 'text',
      x: 20,
      y,
      width: 350,
      height: 40,
      content: tip,
      fontSize: 13,
      color: '#555555',
    })
  }

  // Yes / No buttons — within usable area (matching default y=700 from createYesNoDefaultLayouts)
  elements.push({
    type: 'button',
    x: 20,
    y: 700,
    width: 160,
    height: 44,
    label: yesLabel,
    outputValue: 'true',
    deletable: false,
  })
  elements.push({
    type: 'button',
    x: 210,
    y: 700,
    width: 160,
    height: 44,
    label: noLabel,
    outputValue: 'false',
    deletable: false,
  })

  return [{ deviceType: 'phone', canvasWidth: 390, canvasHeight: 844, elements }]
}

/**
 * Create a USER_INTERACTION step with form_layout_config.
 */
function instructionStep(localId, position, { title, image, bodyLines, tip }) {
  return step(localId, 'USER_INTERACTION', {
    position,
    ui_parameter_specifications: [
      { oid: oid(), type: 'Header', value: title, font_size: 22, align: 'center' },
      ...(image ? [{ oid: oid(), type: 'Image', value: image }] : []),
      { oid: oid(), type: 'Divider', value: '' },
      ...bodyLines.map((line) => ({ oid: oid(), type: 'Text', value: line, font_size: 15 })),
      ...(tip ? [{ oid: oid(), type: 'SmallText', value: tip, font_size: 13, color: '#555555' }] : []),
      { oid: oid(), type: 'Button', value: 'Done' },
    ],
    form_layout_config: buildPhoneLayout({ title, image, bodyLines, tip }),
  })
}

// ─── Build the Workflow ──────────────────────────────────────────────────────

const steps = []
const connections = []

const CX = 300
const LX = 50
const RX = 550
const DY = 250
let row = 0

// ── Row 0: START ──
const start = step('Start', 'START', { position: { x: CX, y: row * DY } })
steps.push(start)
row++

// ── Row 1: Gather Ingredients ──
const gatherIngredients = instructionStep(
  'Gather Ingredients',
  { x: CX, y: row * DY },
  {
    title: 'Gather Your Ingredients',
    image: 'ingredients.jpg',
    bodyLines: [
      '500g ground beef (or 250g beef + 250g pork)',
      '1 medium onion, 2 carrots, 2 celery stalks',
      '4 cloves garlic',
      '1 can (400g) crushed San Marzano tomatoes',
      '2 tbsp tomato paste',
      '1 cup (250ml) dry red wine (optional)',
      '400g spaghetti or tagliatelle',
      '2 tbsp olive oil, 1 tbsp butter',
      'Salt, black pepper, 1 tsp dried oregano, 2 bay leaves',
      'Fresh basil, Parmigiano-Reggiano for serving',
    ],
    tip: 'Mise en place: measure and organize everything before you start cooking.',
  },
)
steps.push(gatherIngredients)
connections.push(conn(start.oid, gatherIngredients.oid))
row++

// ── Row 2: PARALLEL #1 ──
const parallel1 = step('Start Parallel Prep', 'PARALLEL', { position: { x: CX, y: row * DY } })
steps.push(parallel1)
connections.push(conn(gatherIngredients.oid, parallel1.oid))
row++

// ── Row 3 left: Fill & Boil Water ──
const fillWater = instructionStep(
  'Fill & Boil Water',
  { x: LX, y: row * DY },
  {
    title: 'Start Boiling Water',
    image: 'boil-water.jpg',
    bodyLines: [
      'Fill a large pot with 4-5 liters of water.',
      'Place on the stove over high heat and cover.',
      'This will come to a boil while you prep.',
    ],
    tip: 'Starting water first maximizes your time — it takes 10-15 minutes to boil.',
  },
)
steps.push(fillWater)
connections.push(conn(parallel1.oid, fillWater.oid))

// ── Row 3 right: Prep Vegetables ──
const prepVegetables = instructionStep(
  'Prep Vegetables',
  { x: RX, y: row * DY },
  {
    title: 'Prepare the Soffritto',
    image: 'prep-vegetables.jpg',
    bodyLines: [
      'Finely dice the onion into small (3mm) pieces.',
      'Peel and finely dice the carrots.',
      'Finely dice the celery stalks.',
      'Mince the garlic cloves separately.',
    ],
    tip: 'The finer you dice, the more they melt into the sauce. This is the flavor base of Italian cooking.',
  },
)
steps.push(prepVegetables)
connections.push(conn(parallel1.oid, prepVegetables.oid))
row++

// ── Row 4: WAIT ALL #1 ──
const waitAll1 = step('Prep Complete', 'WAIT ALL', { position: { x: CX, y: row * DY } })
steps.push(waitAll1)
connections.push(conn(fillWater.oid, waitAll1.oid))
connections.push(conn(prepVegetables.oid, waitAll1.oid))
row++

// ── Row 5: Brown the Meat ──
const brownMeat = instructionStep(
  'Brown the Meat',
  { x: CX, y: row * DY },
  {
    title: 'Brown the Ground Beef',
    image: 'brown-meat.jpg',
    bodyLines: [
      'Heat 2 tbsp olive oil + 1 tbsp butter in a large Dutch oven over medium-high heat.',
      'Add the ground beef, breaking it into pieces.',
      'Cook 5-7 minutes until well browned.',
      'Do NOT drain the fat — it adds flavor.',
    ],
    tip: 'Let the meat sit undisturbed for a minute to develop a good brown crust (Maillard reaction).',
  },
)
steps.push(brownMeat)
connections.push(conn(waitAll1.oid, brownMeat.oid))
row++

// ── Row 6: Add Soffritto ──
const addSoffritto = instructionStep(
  'Add Soffritto',
  { x: CX, y: row * DY },
  {
    title: 'Add the Soffritto',
    image: 'soffritto.jpg',
    bodyLines: [
      'Add the diced onion, carrot, and celery to the browned meat.',
      'Season with a pinch of salt.',
      'Cook 5-7 minutes, stirring occasionally, until softened and translucent.',
    ],
    tip: 'Reduce heat to medium if they start to color too fast. They should be soft, not browned.',
  },
)
steps.push(addSoffritto)
connections.push(conn(brownMeat.oid, addSoffritto.oid))
row++

// ── Row 7: Add Garlic & Tomato Paste ──
const addGarlicPaste = instructionStep(
  'Add Garlic & Paste',
  { x: CX, y: row * DY },
  {
    title: 'Add Garlic & Tomato Paste',
    image: 'garlic-paste.jpg',
    bodyLines: [
      'Push the meat and vegetables to the side.',
      'Add minced garlic and 2 tbsp tomato paste to the cleared space.',
      'Stir the paste on the hot spot for 1-2 minutes until it darkens slightly.',
      'Then mix everything together.',
    ],
    tip: 'Cooking tomato paste directly on the hot surface caramelizes it and deepens the flavor.',
  },
)
steps.push(addGarlicPaste)
connections.push(conn(addSoffritto.oid, addGarlicPaste.oid))
row++

// ── Row 8: YES/NO — Add Wine? ──
const addWineDecision = step('Add Wine?', 'YES_NO', {
  position: { x: CX, y: row * DY },
  output_parameter_name: 'use_wine',
  ui_parameter_specifications: [
    { oid: oid(), type: 'Header', value: 'Add Red Wine?', font_size: 20, align: 'center' },
    { oid: oid(), type: 'Image', value: 'wine.jpg' },
    { oid: oid(), type: 'Divider', value: '' },
    {
      oid: oid(),
      type: 'Text',
      value: 'Red wine adds depth and complexity. A dry red like Chianti works best.',
      font_size: 15,
    },
    {
      oid: oid(),
      type: 'SmallText',
      value: 'You can substitute with beef stock or skip this step.',
      font_size: 13,
      color: '#555555',
    },
    { oid: oid(), type: 'YesNoButtons', value: 'Yes, Add Wine', value2: 'No, Skip Wine' },
  ],
  yes_no_config: {
    yes_label: 'Yes, Add Wine',
    no_label: 'No, Skip Wine',
    yes_value: 'true',
    no_value: 'false',
    default_selection: 'none',
  },
  form_layout_config: buildYesNoLayout({
    title: 'Add Red Wine?',
    image: 'wine.jpg',
    questionLines: [
      'Red wine adds depth and complexity to the sauce.',
      'A dry red like Chianti or Sangiovese works best.',
      'You can substitute with beef stock or skip this step.',
    ],
    tip: null,
    yesLabel: 'Yes, Add Wine',
    noLabel: 'No, Skip Wine',
  }),
})
steps.push(addWineDecision)
connections.push(conn(addGarlicPaste.oid, addWineDecision.oid))
row++

// ── Row 9: YES path — Deglaze with Wine ──
const deglazeWine = instructionStep(
  'Deglaze with Wine',
  { x: LX, y: row * DY },
  {
    title: 'Deglaze with Red Wine',
    image: null,
    bodyLines: [
      'Pour in 1 cup (250ml) of dry red wine.',
      'Scrape the bottom of the pot to release browned bits (fond).',
      'Simmer and reduce by about half — 3-4 minutes.',
      'The alcohol will cook off, leaving rich flavor.',
    ],
    tip: "You'll know it's ready when the harsh alcohol smell fades and the liquid thickens.",
  },
)
steps.push(deglazeWine)
connections.push(conn(addWineDecision.oid, deglazeWine.oid, { source_handle_id: 'yes' }))

// ── Row 10: WAIT ANY #1 ──
row++
const waitAny1 = step('Continue', 'WAIT ANY', { position: { x: CX, y: row * DY } })
steps.push(waitAny1)
connections.push(conn(deglazeWine.oid, waitAny1.oid))
connections.push(conn(addWineDecision.oid, waitAny1.oid, { source_handle_id: 'no' }))
row++

// ── Row 11: Add Tomatoes & Herbs ──
const addTomatoes = instructionStep(
  'Add Tomatoes & Herbs',
  { x: CX, y: row * DY },
  {
    title: 'Add Tomatoes & Herbs',
    image: 'tomatoes-herbs.jpg',
    bodyLines: [
      'Pour in the can (400g) of crushed San Marzano tomatoes.',
      'Add 1 tsp dried oregano and 2 bay leaves.',
      'Season with salt and freshly ground black pepper.',
      'Stir well to combine everything.',
    ],
    tip: 'If using whole canned tomatoes, crush them by hand for a rustic texture.',
  },
)
steps.push(addTomatoes)
connections.push(conn(waitAny1.oid, addTomatoes.oid))
row++

// ── Row 12: PARALLEL #2 ──
const parallel2 = step('Simmer & Cook Pasta', 'PARALLEL', { position: { x: CX, y: row * DY } })
steps.push(parallel2)
connections.push(conn(addTomatoes.oid, parallel2.oid))
row++

// ── Row 13 left: Simmer Sauce ──
const simmerSauce = instructionStep(
  'Simmer Sauce',
  { x: LX, y: row * DY },
  {
    title: 'Simmer the Sauce (30 min)',
    image: 'simmer-sauce.jpg',
    bodyLines: [
      'Reduce heat to LOW.',
      'Partially cover with a lid (leave a gap for steam).',
      'Simmer gently for 30 minutes, stirring every 8-10 minutes.',
      'The sauce will thicken and the flavors meld.',
    ],
    tip: 'Too thick? Add a splash of pasta water. Too thin? Remove the lid to evaporate.',
  },
)
steps.push(simmerSauce)
connections.push(conn(parallel2.oid, simmerSauce.oid))

// ── Row 13 right: Cook Pasta ──
const cookPasta = instructionStep(
  'Cook the Pasta',
  { x: RX, y: row * DY },
  {
    title: 'Salt Water & Cook Pasta',
    image: 'cook-pasta.jpg',
    bodyLines: [
      'Once water boils, add 2 tbsp salt.',
      'Add 400g spaghetti and stir immediately.',
      'Cook per package directions MINUS 1 minute (al dente).',
      'Before draining, reserve 1 cup starchy pasta water.',
    ],
    tip: 'Start pasta about 15 minutes into the simmer so both finish together. The starchy water is liquid gold!',
  },
)
steps.push(cookPasta)
connections.push(conn(parallel2.oid, cookPasta.oid))
row++

// ── Row 14: WAIT ALL #2 ──
const waitAll2 = step('Sauce & Pasta Ready', 'WAIT ALL', { position: { x: CX, y: row * DY } })
steps.push(waitAll2)
connections.push(conn(simmerSauce.oid, waitAll2.oid))
connections.push(conn(cookPasta.oid, waitAll2.oid))
row++

// ── Row 15: YES/NO — Taste & Adjust ──
const seasonCheck = step('Adjust Seasoning?', 'YES_NO', {
  position: { x: CX, y: row * DY },
  output_parameter_name: 'needs_seasoning',
  ui_parameter_specifications: [
    { oid: oid(), type: 'Header', value: 'Taste the Sauce', font_size: 20, align: 'center' },
    { oid: oid(), type: 'Divider', value: '' },
    { oid: oid(), type: 'Text', value: 'Remove the bay leaves. Taste the sauce carefully.', font_size: 15 },
    { oid: oid(), type: 'Text', value: 'Does it need more salt, pepper, or a pinch of sugar?', font_size: 15 },
    { oid: oid(), type: 'YesNoButtons', value: 'Yes, Adjust', value2: 'No, Perfect!' },
  ],
  yes_no_config: {
    yes_label: 'Yes, Adjust',
    no_label: 'No, Perfect!',
    yes_value: 'true',
    no_value: 'false',
    default_selection: 'none',
  },
  form_layout_config: buildYesNoLayout({
    title: 'Taste the Sauce',
    image: null,
    questionLines: [
      'Remove the bay leaves.',
      'Taste the sauce carefully.',
      'Does it need more salt, pepper, or a pinch of sugar to balance acidity?',
    ],
    tip: null,
    yesLabel: 'Yes, Adjust',
    noLabel: 'No, Perfect!',
  }),
})
steps.push(seasonCheck)
connections.push(conn(waitAll2.oid, seasonCheck.oid))
row++

// ── Row 16: YES path — Adjust Seasoning ──
const adjustSeasoning = instructionStep(
  'Adjust Seasoning',
  { x: LX, y: row * DY },
  {
    title: 'Adjust Seasoning',
    image: null,
    bodyLines: [
      'Add salt in small pinches, stirring and tasting after each.',
      'Add freshly ground black pepper to taste.',
      'If too acidic, add a tiny pinch of sugar (1/4 tsp).',
      'Stir well and simmer 1-2 more minutes.',
    ],
    tip: "Season gradually — you can always add more, but can't take it away!",
  },
)
steps.push(adjustSeasoning)
connections.push(conn(seasonCheck.oid, adjustSeasoning.oid, { source_handle_id: 'yes' }))

// ── Row 17: WAIT ANY #2 ──
row++
const waitAny2 = step('Continue', 'WAIT ANY', { position: { x: CX, y: row * DY } })
steps.push(waitAny2)
connections.push(conn(adjustSeasoning.oid, waitAny2.oid))
connections.push(conn(seasonCheck.oid, waitAny2.oid, { source_handle_id: 'no' }))
row++

// ── Row 18: Drain & Combine ──
const drainCombine = instructionStep(
  'Drain & Combine',
  { x: CX, y: row * DY },
  {
    title: 'Drain & Combine Pasta with Sauce',
    image: 'combine.jpg',
    bodyLines: [
      'Drain the pasta (save that pasta water!).',
      'Add drained pasta directly into the sauce pot.',
      'Toss vigorously over medium heat for 1-2 minutes.',
      'Add splashes of reserved pasta water for a silky coating.',
    ],
    tip: 'The starch emulsifies with fat, creating that restaurant-quality glossy finish.',
  },
)
steps.push(drainCombine)
connections.push(conn(waitAny2.oid, drainCombine.oid))
row++

// ── Row 19: Plate & Serve ──
const plateServe = instructionStep(
  'Plate & Serve',
  { x: CX, y: row * DY },
  {
    title: 'Plate & Serve — Buon Appetito!',
    image: 'plate-serve.jpg',
    bodyLines: [
      'Divide the pasta into warmed bowls using tongs.',
      'Top with freshly grated Parmigiano-Reggiano.',
      'Garnish with fresh basil leaves.',
      'Serve with crusty bread and the rest of the wine.',
    ],
    tip: 'Warm your bowls with hot water — keeps the pasta hot longer at the table.',
  },
)
steps.push(plateServe)
connections.push(conn(drainCombine.oid, plateServe.oid))
row++

// ── Row 20: END ──
const end = step('End', 'END', { position: { x: CX, y: row * DY } })
steps.push(end)
connections.push(conn(plateServe.oid, end.oid))

// ─── Assemble Workflow ───────────────────────────────────────────────────────

const workflow = {
  local_id: 'Spaghetti Bolognese Dinner',
  oid: oid(),
  version: '1.0.0',
  last_modified_date: isoNow(),
  description:
    'Complete recipe for classic Spaghetti Bolognese, optimized for a single cook. ' +
    'Parallel steps for efficient time management. Optional red wine deglaze and seasoning adjustment.',
  schemaVersion: '4.0',
  steps,
  connections,
  viewport: { x: 100, y: 20, zoom: 0.22 },
}

// ─── Package as .WFmasterX ZIP ───────────────────────────────────────────────

async function main() {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })

  const zip = new JSZip()
  zip.file('Spaghetti Bolognese Dinner.WFmaster', JSON.stringify(workflow, null, 2))

  console.log('Downloading recipe images from Pexels...')
  let imageCount = 0
  for (const [filename, photoId] of Object.entries(PEXELS_IMAGES)) {
    const url = pexelsUrl(photoId)
    try {
      const buf = await downloadImage(url)
      zip.file(`images/${filename}`, buf)
      imageCount++
      console.log(`  [${imageCount}/${Object.keys(PEXELS_IMAGES).length}] ${filename}`)
    } catch (err) {
      console.warn(`  WARN: Could not download ${filename}: ${err.message}`)
    }
  }

  const manifest = {
    workflowName: 'Spaghetti Bolognese Dinner',
    environmentLibraries: [],
    actionLibraries: [],
    files: [
      { path: 'Spaghetti Bolognese Dinner.WFmaster', type: 'workflow' },
      ...Object.keys(PEXELS_IMAGES).map((f) => ({ path: `images/${f}`, type: 'image' })),
    ],
  }
  zip.file('manifest.json', JSON.stringify(manifest, null, 2))

  const buf = await zip.generateAsync({ type: 'nodebuffer' })
  const outPath = join(OUT_DIR, 'Spaghetti Bolognese Dinner.WFmasterX')
  writeFileSync(outPath, buf)

  console.log()
  console.log(`Created: ${outPath}`)
  console.log(`  ${steps.length} steps, ${connections.length} connections, ${imageCount} images`)
  console.log(`  Step types: ${[...new Set(steps.map((s) => s.step_type))].join(', ')}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
