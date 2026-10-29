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
 * Generates a "Chicken Parmesan Recipe" workflow as a .WFmasterX ZIP file
 * importable via the Mission Designer Import Workflow button.
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const JSZip = require('jszip')

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, '..', 'test-data')

let _oidCounter = 2000000000000
function oid() {
  return String(++_oidCounter)
}

function isoNow() {
  return new Date().toISOString()
}

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

// ─── Build the workflow ───────────────────────────────────────────────────────

const steps = []
const connections = []
let x = 100
const Y = 300

// 1. START
const start = step('Start', 'START', { position: { x, y: Y } })
steps.push(start)
x += 280

// 2. CHECKBOX — Ingredient Check
const ingredientCheck = step('Gather Ingredients', 'CHECKBOX', {
  position: { x, y: Y },
  output_parameter_name: 'ingredients_checked',
  ui_parameter_specifications: [
    { oid: oid(), type: 'Header', value: 'Ingredient Checklist', font_size: 20, align: 'center' },
    { oid: oid(), type: 'Text', value: 'Confirm you have all ingredients before starting.', font_size: 14 },
    { oid: oid(), type: 'Divider', value: '' },
    { oid: oid(), type: 'CheckboxList', value: 'Ingredients' },
  ],
  checkbox_config: {
    options: [
      { id: oid(), label: '4 boneless skinless chicken breasts', value: 'chicken', default_checked: false },
      { id: oid(), label: '1 cup all-purpose flour', value: 'flour', default_checked: false },
      { id: oid(), label: '3 large eggs', value: 'eggs', default_checked: false },
      { id: oid(), label: '1½ cups Italian breadcrumbs', value: 'breadcrumbs', default_checked: false },
      { id: oid(), label: '1 cup grated Parmesan cheese', value: 'parmesan', default_checked: false },
      { id: oid(), label: '2 cups marinara sauce', value: 'marinara', default_checked: false },
      { id: oid(), label: '2 cups shredded mozzarella', value: 'mozzarella', default_checked: false },
      { id: oid(), label: '3 tbsp olive oil', value: 'olive_oil', default_checked: false },
      { id: oid(), label: 'Salt and black pepper', value: 'seasoning', default_checked: false },
      { id: oid(), label: 'Fresh basil leaves (garnish)', value: 'basil', default_checked: false },
      { id: oid(), label: '2 cloves garlic, minced', value: 'garlic', default_checked: false },
    ],
    output_format: 'array',
    min_selections: 11,
    max_selections: 11,
  },
})
steps.push(ingredientCheck)
connections.push(conn(start.oid, ingredientCheck.oid))
x += 280

// 3. PARALLEL fork — Prep breading + Pound chicken
const parallel = step('Prep In Parallel', 'PARALLEL', { position: { x, y: Y } })
steps.push(parallel)
connections.push(conn(ingredientCheck.oid, parallel.oid))
x += 280

// Branch A — Prepare Breading Station (top)
const prepBreading = step('Set Up Breading Station', 'INSTRUCTION', {
  position: { x, y: Y - 150 },
  ui_parameter_specifications: [
    { oid: oid(), type: 'Header', value: 'Prepare Breading Station', font_size: 20, align: 'center' },
    { oid: oid(), type: 'Divider', value: '' },
    { oid: oid(), type: 'Text', value: 'Set up three shallow dishes in a row:', font_size: 16 },
    {
      oid: oid(),
      type: 'Text',
      value: '1. Flour seasoned with salt and pepper\n2. Beaten eggs\n3. Breadcrumbs mixed with ½ cup grated Parmesan',
      font_size: 14,
    },
    { oid: oid(), type: 'Button', value: 'Done' },
  ],
})
steps.push(prepBreading)
connections.push(conn(parallel.oid, prepBreading.oid))

// Branch B — Pound Chicken (bottom)
const poundChicken = step('Pound Chicken Breasts', 'INSTRUCTION', {
  position: { x, y: Y + 150 },
  ui_parameter_specifications: [
    { oid: oid(), type: 'Header', value: 'Pound the Chicken', font_size: 20, align: 'center' },
    { oid: oid(), type: 'Divider', value: '' },
    { oid: oid(), type: 'Text', value: 'Place each chicken breast between two sheets of plastic wrap.', font_size: 16 },
    {
      oid: oid(),
      type: 'Text',
      value: 'Pound with a meat mallet to an even ½-inch thickness. This ensures even cooking.',
      font_size: 14,
    },
    {
      oid: oid(),
      type: 'SmallText',
      value: 'Season both sides of each breast with salt and pepper.',
      font_size: 13,
      color: '#555555',
    },
    { oid: oid(), type: 'Button', value: 'Done' },
  ],
})
steps.push(poundChicken)
connections.push(conn(parallel.oid, poundChicken.oid))
x += 280

// 4. WAIT ALL — rejoin prep
const waitAll = step('Prep Complete', 'WAIT ALL', { position: { x, y: Y } })
steps.push(waitAll)
connections.push(conn(prepBreading.oid, waitAll.oid))
connections.push(conn(poundChicken.oid, waitAll.oid))
x += 280

// 5. Dredge in flour
const dredge = step('Dredge in Flour', 'INSTRUCTION', {
  position: { x, y: Y },
  ui_parameter_specifications: [
    { oid: oid(), type: 'Header', value: 'Step 1: Flour Coating', font_size: 20, align: 'center' },
    { oid: oid(), type: 'Divider', value: '' },
    {
      oid: oid(),
      type: 'Text',
      value: 'Dredge each chicken breast in the seasoned flour. Shake off excess.',
      font_size: 16,
    },
    {
      oid: oid(),
      type: 'SmallText',
      value: 'The flour helps the egg adhere to the chicken.',
      font_size: 13,
      color: '#555555',
    },
    { oid: oid(), type: 'Button', value: 'Done' },
  ],
})
steps.push(dredge)
connections.push(conn(waitAll.oid, dredge.oid))
x += 280

// 6. Dip in eggs
const eggDip = step('Dip in Egg Wash', 'INSTRUCTION', {
  position: { x, y: Y },
  ui_parameter_specifications: [
    { oid: oid(), type: 'Header', value: 'Step 2: Egg Wash', font_size: 20, align: 'center' },
    { oid: oid(), type: 'Divider', value: '' },
    {
      oid: oid(),
      type: 'Text',
      value: 'Dip the floured chicken into the beaten eggs, coating both sides evenly.',
      font_size: 16,
    },
    {
      oid: oid(),
      type: 'SmallText',
      value: 'Let excess egg drip off before moving to breadcrumbs.',
      font_size: 13,
      color: '#555555',
    },
    { oid: oid(), type: 'Button', value: 'Done' },
  ],
})
steps.push(eggDip)
connections.push(conn(dredge.oid, eggDip.oid))
x += 280

// 7. Coat in breadcrumbs
const breadcrumb = step('Coat in Breadcrumbs', 'INSTRUCTION', {
  position: { x, y: Y },
  ui_parameter_specifications: [
    { oid: oid(), type: 'Header', value: 'Step 3: Breadcrumb Coating', font_size: 20, align: 'center' },
    { oid: oid(), type: 'Divider', value: '' },
    {
      oid: oid(),
      type: 'Text',
      value: 'Press the chicken firmly into the breadcrumb-Parmesan mixture, coating both sides.',
      font_size: 16,
    },
    {
      oid: oid(),
      type: 'SmallText',
      value: 'Press gently to make sure the coating sticks well. Place on a wire rack.',
      font_size: 13,
      color: '#555555',
    },
    { oid: oid(), type: 'Button', value: 'Done' },
  ],
})
steps.push(breadcrumb)
connections.push(conn(eggDip.oid, breadcrumb.oid))
x += 280

// 8. PARALLEL fork — Pan-fry + top chicken WHILE oven preheats
const parallel2 = step('Cook & Preheat', 'PARALLEL', { position: { x, y: Y } })
steps.push(parallel2)
connections.push(conn(breadcrumb.oid, parallel2.oid))
x += 280

// Branch A (top) — Preheat Oven
const preheatOven = step('Preheat Oven', 'INSTRUCTION', {
  position: { x, y: Y - 200 },
  ui_parameter_specifications: [
    { oid: oid(), type: 'Header', value: 'Preheat the Oven', font_size: 20, align: 'center' },
    { oid: oid(), type: 'Divider', value: '' },
    { oid: oid(), type: 'Text', value: 'Set the oven to 400°F (200°C).', font_size: 16 },
    {
      oid: oid(),
      type: 'SmallText',
      value: 'Use the middle rack position. The oven will heat up while you pan-fry and assemble.',
      font_size: 13,
      color: '#555555',
    },
    { oid: oid(), type: 'Button', value: 'Done' },
  ],
})
steps.push(preheatOven)
connections.push(conn(parallel2.oid, preheatOven.oid))

// Branch B (bottom) — Pan-fry → Top with sauce/cheese (sequential chain)
const panFry = step('Pan-Fry Until Golden', 'INSTRUCTION', {
  position: { x, y: Y + 100 },
  ui_parameter_specifications: [
    { oid: oid(), type: 'Header', value: 'Pan-Fry the Chicken', font_size: 20, align: 'center' },
    { oid: oid(), type: 'Divider', value: '' },
    { oid: oid(), type: 'Text', value: 'Heat olive oil in a large skillet over medium-high heat.', font_size: 16 },
    {
      oid: oid(),
      type: 'Text',
      value: 'Cook chicken 3-4 minutes per side until golden brown and crispy.',
      font_size: 16,
    },
    {
      oid: oid(),
      type: 'SmallText',
      value:
        'Do not crowd the pan — work in batches if needed. The chicken does not need to be cooked through; it will finish in the oven.',
      font_size: 13,
      color: '#555555',
    },
    { oid: oid(), type: 'Button', value: 'Done' },
  ],
})
steps.push(panFry)
connections.push(conn(parallel2.oid, panFry.oid))
x += 280

const topIt = step('Add Sauce and Cheese', 'INSTRUCTION', {
  position: { x, y: Y + 100 },
  ui_parameter_specifications: [
    { oid: oid(), type: 'Header', value: 'Top with Marinara & Mozzarella', font_size: 20, align: 'center' },
    { oid: oid(), type: 'Divider', value: '' },
    {
      oid: oid(),
      type: 'Text',
      value: 'Transfer chicken to a baking dish. Spoon marinara sauce over each piece.',
      font_size: 16,
    },
    {
      oid: oid(),
      type: 'Text',
      value: 'Top generously with shredded mozzarella and remaining Parmesan.',
      font_size: 16,
    },
    {
      oid: oid(),
      type: 'SmallText',
      value: 'Add minced garlic to the marinara for extra flavor.',
      font_size: 13,
      color: '#555555',
    },
    { oid: oid(), type: 'Button', value: 'Done' },
  ],
})
steps.push(topIt)
connections.push(conn(panFry.oid, topIt.oid))
x += 280

// 9. WAIT ALL — oven ready + chicken assembled
const waitAll2 = step('Oven Ready & Chicken Assembled', 'WAIT ALL', { position: { x, y: Y } })
steps.push(waitAll2)
connections.push(conn(preheatOven.oid, waitAll2.oid))
connections.push(conn(topIt.oid, waitAll2.oid))
x += 280

// 10. Bake
const bake = step('Bake in Oven', 'INSTRUCTION', {
  position: { x, y: Y },
  ui_parameter_specifications: [
    { oid: oid(), type: 'Header', value: 'Bake Until Bubbly', font_size: 20, align: 'center' },
    { oid: oid(), type: 'Divider', value: '' },
    { oid: oid(), type: 'Text', value: 'Place the baking dish in the preheated 400°F oven.', font_size: 16 },
    {
      oid: oid(),
      type: 'Text',
      value:
        'Bake for 15-20 minutes until the cheese is melted and bubbly, and the chicken reaches an internal temperature of 165°F.',
      font_size: 16,
    },
    {
      oid: oid(),
      type: 'SmallText',
      value: 'If you want a browned top, broil on high for 1-2 minutes at the end — watch carefully to avoid burning.',
      font_size: 13,
      color: '#555555',
    },
    { oid: oid(), type: 'Button', value: 'Done' },
  ],
})
steps.push(bake)
connections.push(conn(waitAll2.oid, bake.oid))
x += 280

// 11. Garnish and serve
const serve = step('Garnish and Serve', 'INSTRUCTION', {
  position: { x, y: Y },
  ui_parameter_specifications: [
    { oid: oid(), type: 'Header', value: 'Garnish & Serve', font_size: 20, align: 'center' },
    { oid: oid(), type: 'Divider', value: '' },
    { oid: oid(), type: 'Text', value: 'Remove from oven and let rest for 2-3 minutes.', font_size: 16 },
    {
      oid: oid(),
      type: 'Text',
      value: 'Garnish with fresh basil leaves. Serve over spaghetti, with a side salad, or with crusty bread.',
      font_size: 16,
    },
    { oid: oid(), type: 'SmallText', value: 'Buon appetito!', font_size: 14, color: '#2e7d32' },
    { oid: oid(), type: 'Button', value: 'Done' },
  ],
})
steps.push(serve)
connections.push(conn(bake.oid, serve.oid))
x += 280

// 12. END
const end = step('End', 'END', { position: { x, y: Y } })
steps.push(end)
connections.push(conn(serve.oid, end.oid))

// ─── Assemble workflow specification ──────────────────────────────────────────

const workflow = {
  local_id: 'Chicken Parmesan Recipe',
  oid: oid(),
  version: '1.0.0',
  last_modified_date: isoNow(),
  description:
    'Step-by-step recipe for classic homemade Chicken Parmesan with crispy breaded chicken, marinara sauce, and melted mozzarella.',
  schemaVersion: '3.0',
  steps,
  connections,
  viewport: { x: 0, y: 150, zoom: 0.55 },
}

// ─── Package as .WFmasterX ZIP ────────────────────────────────────────────────

async function main() {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })

  const zip = new JSZip()
  zip.file('Chicken Parmesan Recipe.WFmaster', JSON.stringify(workflow, null, 2))

  const buf = await zip.generateAsync({ type: 'nodebuffer' })
  const outPath = join(OUT_DIR, 'Chicken Parmesan Recipe.WFmasterX')
  writeFileSync(outPath, buf)

  console.log(`Created: ${outPath}`)
  console.log(`  ${steps.length} steps, ${connections.length} connections`)
  console.log(`  Step types: ${[...new Set(steps.map((s) => s.step_type))].join(', ')}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
