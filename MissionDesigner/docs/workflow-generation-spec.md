# Workflow Generation Specification

> **For Claude:** When the user asks you to generate a workflow from a procedure description,
> follow this specification exactly to produce a `.WFmasterX` file that can be imported into
> Mission Designer via the Import Workflow button.

## Overview

Generate a Node.js `.mjs` script in `scripts/` that builds a `.WFmasterX` ZIP file in `test-data/`.
The script downloads images, assembles workflow JSON, and packages everything as an importable ZIP.
Reference existing generators (`scripts/generate-vrf-inspection.mjs`, `scripts/generate-bolognese.mjs`)
for working examples.

---

## 1. Output Package Format (`.WFmasterX`)

A `.WFmasterX` file is a ZIP archive containing:

| ZIP path                  | Content                |
| ------------------------- | ---------------------- |
| `manifest.json`           | Package metadata       |
| `{WorkflowName}.WFmaster` | Workflow JSON          |
| `images/{filename}`       | Downloaded image files |

**manifest.json:**

```json
{
  "workflowName": "My Workflow",
  "environmentLibraries": [],
  "actionLibraries": [],
  "files": [
    { "path": "My Workflow.WFmaster", "type": "workflow" },
    { "path": "images/photo.jpg", "type": "image" }
  ]
}
```

---

## 2. Workflow JSON Structure

```json
{
  "schemaVersion": "4.0",
  "local_id": "Workflow Name",
  "oid": "6000000000001",
  "version": "1.0.0",
  "last_modified_date": "2026-01-15T12:00:00.000Z",
  "description": "Optional description",
  "steps": [],
  "connections": [],
  "viewport": { "x": 100, "y": 20, "zoom": 0.18 }
}
```

- `schemaVersion` MUST be `"4.0"`
- `oid` values: use an incrementing counter starting at `6000000000000`, returned as strings

---

## 3. Step Types

| `step_type` value  | Purpose                   | When to use                                   |
| ------------------ | ------------------------- | --------------------------------------------- |
| `START`            | Entry point               | Exactly one per workflow                      |
| `END`              | Exit point                | Exactly one per workflow                      |
| `USER_INTERACTION` | Form-based step with UI   | Instructions, data entry, images, text        |
| `YES_NO`           | Binary decision           | When procedure branches on a yes/no question  |
| `PARALLEL`         | Fork into parallel paths  | When independent tasks can run simultaneously |
| `WAIT_ALL`         | Join parallel paths       | Barrier that waits for all parallel branches  |
| `WAIT ANY`         | Rejoin exclusive branches | After YES_NO branches converge                |
| `SELECT 1`         | Multi-way branch          | When >2 branch options exist                  |
| `SCRIPT`           | Python code execution     | Computed values or automation                 |

### Step Object Structure

```json
{
  "local_id": "Step Name",
  "oid": "6000000000001",
  "version": "1.0.0",
  "last_modified_date": "2026-01-15T12:00:00.000Z",
  "step_type": "USER_INTERACTION",
  "position": { "x": 300, "y": 0 }
}
```

---

## 4. Connection Object Structure

```json
{
  "from_step_id": "6000000000001",
  "to_step_id": "6000000000002",
  "connection_id": "6000000000099"
}
```

For YES_NO branches, add `"source_handle_id": "yes"` or `"source_handle_id": "no"`.

---

## 5. Node Positioning

- `CX = 300` - center column X (main flow)
- `LX = 50` - left branch X (e.g., YES path)
- `RX = 550` - right branch X (e.g., NO path or parallel branch)
- `DY = 250` - vertical spacing between rows
- Use a `row` counter; each step is at `{ x: CX, y: row * DY }`
- Branch steps offset horizontally from center

---

## 6. USER_INTERACTION Step (Form Steps)

Every USER_INTERACTION step needs both `ui_parameter_specifications` and `form_layout_config`.

### 6a. `ui_parameter_specifications` Array

Each entry has `{ oid, type, value }` plus optional fields:

| `type`         | `value`          | Optional fields                     |
| -------------- | ---------------- | ----------------------------------- |
| `Header`       | Title text       | `font_size: 22`, `align: 'center'`  |
| `Image`        | Filename key     |                                     |
| `Divider`      | `''`             |                                     |
| `Text`         | Body text line   | `font_size: 15`                     |
| `SmallText`    | Tip/note text    | `font_size: 13`, `color: '#555555'` |
| `TextInput`    | Placeholder text | `lines: 1`                          |
| `Button`       | Button label     |                                     |
| `Video`        | Video URL        |                                     |
| `YesNoButtons` | Yes label        | `value2: 'No label'`                |

**Standard order:** Header, Image (optional), Divider, Text lines, SmallText (optional), TextInput pairs (optional), Button

For text inputs, precede each TextInput with a Text label:

```json
{ "oid": "...", "type": "Text", "value": "Field Label", "font_size": 14 },
{ "oid": "...", "type": "TextInput", "value": "Enter value...", "lines": 1 }
```

### 6b. `output_parameter_specifications`

Required when the step has text inputs. One entry per input field:

```json
{ "id": "field_name_key", "oid": "...", "description": "Human Label" }
```

---

## 7. `form_layout_config` (Phone WYSIWYG Layout)

Only provide the phone layout; the importer handles tablet/desktop defaults.

```json
[{
  "deviceType": "phone",
  "canvasWidth": 390,
  "canvasHeight": 844,
  "elements": [...]
}]
```

### Phone Screen Zones

```
y=0        ┌──────────────┐
           │  Chrome top  │  (system bar / header)
y=127      ├──────────────┤
y=130      │              │  ← CONTENT_START_Y (where elements begin)
           │  Content     │
           │  Area        │
           │              │
y=680      │              │  ← max content Y before button
y=700      │  [  Button ] │  ← BUTTON_MAX_Y
y=760      ├──────────────┤
           │ Chrome bottom│
y=844      └──────────────┘
```

- **Content start:** y = 130
- **Max content height:** 550px (130 to 680)
- **Button placement:** y = min(max(contentEndY + 10, 680), 700)
- **Element X:** 20 (left margin)
- **Element width:** 350 (390 - 2\*20 padding)

### Form Element Types

**header:**

```json
{
  "type": "header",
  "x": 20,
  "y": 130,
  "width": 350,
  "height": 36,
  "content": "Title",
  "fontSize": 22,
  "fontWeight": "bold",
  "align": "center"
}
```

Height contribution: 36 + 10 gap = **46px**

**image:**

```json
{ "type": "image", "x": 20, "y": 176, "width": 350, "height": 200, "src": "filename.jpg", "objectFit": "cover" }
```

Height contribution: 200 + 10 gap = **210px**

**divider:**

```json
{ "type": "divider", "x": 20, "y": 386, "width": 350, "height": 2, "thickness": 1, "color": "#e2e8f0" }
```

Height contribution: 2 + 10 gap = **12px**

**text** (body):

```json
{
  "type": "text",
  "x": 20,
  "y": 398,
  "width": 350,
  "height": "max(60, lines * 22 + 10)",
  "content": "Body text here",
  "fontSize": 15
}
```

Height contribution: element height + 10 gap

**text** (tip/note, smaller italic):

```json
{
  "type": "text",
  "x": 20,
  "y": 478,
  "width": 350,
  "height": "max(40, ceil(charCount / 45) * 18 + 10)",
  "content": "Tip text",
  "fontSize": 13,
  "color": "#555555"
}
```

**textInput:**

```json
{
  "type": "textInput",
  "x": 20,
  "y": 500,
  "width": 350,
  "height": 40,
  "label": "Field Label",
  "fontSize": 16,
  "placeholder": "Enter value...",
  "fieldName": "field_name_key",
  "required": true
}
```

Do NOT add a separate text label element above the textInput — the textInput already renders its own label. Each input = textInput (40px + 10 gap) = **50px**

**button** (single action):

```json
{ "type": "button", "x": 95, "y": 700, "width": 200, "height": 44, "label": "Done", "outputValue": "continue" }
```

**button** (YES_NO pair):

```json
{ "type": "button", "x": 20,  "y": 700, "width": 160, "height": 44,
  "label": "Yes", "outputValue": "true", "deletable": false },
{ "type": "button", "x": 210, "y": 700, "width": 160, "height": 44,
  "label": "No",  "outputValue": "false", "deletable": false }
```

**video:**

```json
{ "type": "video", "x": 20, "y": 176, "width": 350, "height": 220, "src": "https://example.com/video.mp4" }
```

Only HTTPS URLs. Height contribution: 220 + 10 gap = **230px**

---

## 8. Auto-Split Rule (MANDATORY)

**Steps MUST be split when content overflows the phone screen.**

### Height Calculation

```
totalHeight = header(46) + divider(12)
            + image(210) if present
            + bodyText(max(60, lineCount * 22 + 10) + 10)
            + tipText(max(40, ceil(charCount/45) * 18 + 10) + 10) if present
            + inputGroups(inputCount * 76) if present
```

### Split Decision

If `totalHeight > 550` AND step has text inputs, split into:

1. **Part 1 (Instruction):** Header + image + body + tip + **"Next"** button (no inputs)
2. **Part 2+ (Recording):** Header "Record: {title}" + text inputs + **"Done"** button

### Recording Screen Limits

- Maximum **6 text inputs per recording screen**
- If more than 6 inputs, split into multiple recording screens:
  - `"Record: {title} (1/N)"`, `"Record: {title} (2/N)"`, etc.
- Connect instruction → recording1 → recording2 → ... sequentially

### No Split Needed When

- `totalHeight <= 550` (everything fits)
- Step has no text inputs (instruction-only steps never split)

---

## 9. YES_NO Decision Steps

```json
{
  "local_id": "Is voltage within spec?",
  "oid": "...",
  "step_type": "YES_NO",
  "position": { "x": 300, "y": 1000 },
  "output_parameter_name": "voltage_within_spec",
  "ui_parameter_specifications": [
    { "oid": "...", "type": "Header", "value": "Voltage Check", "font_size": 20, "align": "center" },
    { "oid": "...", "type": "Divider", "value": "" },
    { "oid": "...", "type": "Text", "value": "Is the voltage within 2% of rated?", "font_size": 15 },
    { "oid": "...", "type": "YesNoButtons", "value": "Yes", "value2": "No" }
  ],
  "yes_no_config": {
    "yes_label": "Yes",
    "no_label": "No",
    "yes_value": "true",
    "no_value": "false",
    "default_selection": "none"
  },
  "form_layout_config": [...]
}
```

**Connection pattern for YES_NO:**

```
       [YES_NO]
      /         \
  yes/           \no
    /             \
[Yes Path]   [No Path]
    \             /
     \           /
      [WAIT ANY]
```

- YES edge: `{ "source_handle_id": "yes" }`
- NO edge: `{ "source_handle_id": "no" }`
- Both paths converge at a `WAIT ANY` step

---

## 10. Parallel Execution (MANDATORY OPTIMIZATION)

**Always optimize for maximum parallelism given a single person performing the steps.**

### Rules for Identifying Parallel Opportunities

1. **Independent inspections:** If two areas/components can be inspected in any order, make them parallel
2. **No data dependency:** Steps that don't need results from each other are parallel candidates
3. **Same location proximity:** Group steps by physical location first, then parallelize between locations
4. **Single-person constraint:** The runtime presents one step at a time from each parallel branch, but the person chooses which branch to work on next

### PARALLEL/WAIT_ALL Pattern

```
           [PARALLEL]
          /     |     \
    [Branch1] [Branch2] [Branch3]
          \     |     /
           [WAIT_ALL]
```

- `PARALLEL` step forks into multiple branches
- Each branch has one or more sequential steps
- `WAIT_ALL` blocks until all branches complete
- Position branches at different X coordinates (LX, CX, RX, or spread evenly)

### When to Use PARALLEL vs Sequential

**Use PARALLEL when:**

- Steps inspect different physical areas (e.g., outdoor unit vs indoor unit)
- Steps collect unrelated measurements
- Steps have no data dependency between them

**Keep sequential when:**

- Step B needs the result of Step A
- Steps must be done in a specific physical order
- Safety requires a specific sequence (e.g., power off before opening panels)

---

## 11. Image and Video Sourcing

### Images

1. **Search for relevant free stock images** (Pexels, Unsplash, Pixabay)
2. Use Pexels URL pattern: `https://images.pexels.com/photos/{id}/pexels-photo-{id}.jpeg?auto=compress&cs=tinysrgb&w=600`
3. Define an image map at the top of the script:
   ```js
   const PEXELS_IMAGES = {
     'outdoor-unit.jpg': 27134985,
     'electrical-panel.jpg': 257736,
   }
   ```
4. Download at script runtime via `fetch()` and add to ZIP as binary
5. Reference in elements by filename key (e.g., `src: 'outdoor-unit.jpg'`)

### Videos

- Use `video` form element with HTTPS URL in `src`
- Only embed if the source procedure references a specific video
- `posterUrl` is optional but recommended for a thumbnail

### When No Suitable Image Exists

- Omit the image element entirely; the step still works fine without it
- Do NOT use placeholder or irrelevant images

---

## 12. Runtime Behavior Reference

When the workflow runs on a mobile device:

| Step Type          | Runtime Behavior                                                        |
| ------------------ | ----------------------------------------------------------------------- |
| `START`            | Automatically advances to next step                                     |
| `USER_INTERACTION` | Displays WYSIWYG form; user fills fields and taps button to advance     |
| `YES_NO`           | Displays question with two buttons; routes to yes or no branch          |
| `PARALLEL`         | Forks execution; user sees first step of each branch, picks which to do |
| `WAIT_ALL`         | Blocks until all parallel branches complete, then auto-advances         |
| `WAIT ANY`         | Advances as soon as any one incoming path completes                     |
| `END`              | Workflow complete; results recorded                                     |

**Text inputs:** Values entered are captured as output parameters and stored in the workflow execution record.

**Images:** Displayed inline in the form at the specified position and size. They help the user identify what they're looking at.

**Videos:** Play inline with standard controls. Use for demonstrating techniques.

**Button actions:** The `outputValue` on a button is recorded; `"continue"` is the fixed value for User Interaction buttons. Yes/No buttons use `"true"`/`"false"`.

---

## 13. Script Template

```js
#!/usr/bin/env node
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const JSZip = require('jszip')

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, '..', 'test-data')

let _oidCounter = 6000000000000
function oid() {
  return String(++_oidCounter)
}
function isoNow() {
  return new Date().toISOString()
}

// ─── Image map ────────────────────────────────────────────────────────────
const PEXELS_IMAGES = {
  'example.jpg': 12345678,
}

function pexelsUrl(photoId) {
  return `https://images.pexels.com/photos/${photoId}/pexels-photo-${photoId}.jpeg?auto=compress&cs=tinysrgb&w=600`
}

async function downloadImage(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

// ─── Height calculator (for auto-split) ───────────────────────────────────
const CONTENT_START_Y = 130
const BUTTON_MAX_Y = 700
const MAX_CONTENT_HEIGHT = 550 // 700 - 130 - 20

function calcHeaderHeight() {
  return 46
}
function calcImageHeight() {
  return 210
}
function calcDividerHeight() {
  return 12
}
function calcBodyHeight(lines) {
  return Math.max(60, lines.length * 22 + 10) + 10
}
function calcTipHeight(tip) {
  if (!tip) return 0
  return Math.max(40, Math.ceil(tip.length / 45) * 18 + 10) + 10
}
function calcInputGroupHeight(textInputs) {
  if (!textInputs || textInputs.length === 0) return 0
  return textInputs.length * 50
}
function calcTotalHeight({ image, bodyLines, tip, textInputs }) {
  let h = calcHeaderHeight() + calcDividerHeight()
  if (image) h += calcImageHeight()
  h += calcBodyHeight(bodyLines)
  h += calcTipHeight(tip)
  h += calcInputGroupHeight(textInputs)
  return h
}

// ─── Step & Connection helpers ────────────────────────────────────────────
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

// ─── Layout builders ──────────────────────────────────────────────────────
// (Copy buildInstructionLayout, buildRecordingLayout, buildCombinedLayout,
//  buildYesNoLayout, instructionStep from generate-vrf-inspection.mjs)

// ─── Build workflow steps and connections ──────────────────────────────────
const steps = []
const connections = []
const CX = 300,
  LX = 50,
  RX = 550,
  DY = 250
let row = 0

// ... assemble steps here ...

// ─── Package as ZIP ───────────────────────────────────────────────────────
async function main() {
  const zip = new JSZip()
  const WORKFLOW_NAME = 'My Workflow'

  // Download images
  const imageBuffers = {}
  for (const [filename, photoId] of Object.entries(PEXELS_IMAGES)) {
    console.log(`Downloading ${filename}...`)
    imageBuffers[filename] = await downloadImage(pexelsUrl(photoId))
  }

  // Add images to ZIP
  for (const [filename, buffer] of Object.entries(imageBuffers)) {
    zip.file(`images/${filename}`, buffer)
  }

  // Add manifest
  const manifest = {
    workflowName: WORKFLOW_NAME,
    environmentLibraries: [],
    actionLibraries: [],
    files: [
      { path: `${WORKFLOW_NAME}.WFmaster`, type: 'workflow' },
      ...Object.keys(imageBuffers).map((f) => ({ path: `images/${f}`, type: 'image' })),
    ],
  }
  zip.file('manifest.json', JSON.stringify(manifest, null, 2))

  // Add workflow JSON
  const workflow = {
    schemaVersion: '4.0',
    local_id: WORKFLOW_NAME,
    oid: oid(),
    version: '1.0.0',
    last_modified_date: isoNow(),
    description: '',
    steps,
    connections,
    viewport: { x: 100, y: 20, zoom: 0.18 },
  }
  zip.file(`${WORKFLOW_NAME}.WFmaster`, JSON.stringify(workflow, null, 2))

  // Write ZIP
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })
  const outPath = join(OUT_DIR, `${WORKFLOW_NAME}.WFmasterX`)
  const buffer = await zip.generateAsync({ type: 'nodebuffer' })
  writeFileSync(outPath, buffer)
  console.log(`\nWritten: ${outPath}`)
  console.log(`Steps: ${steps.length}, Connections: ${connections.length}`)
}

main().catch(console.error)
```

---

## 14. Checklist Before Generating

1. [ ] Identify all procedure steps from the text description
2. [ ] Identify parallel opportunities (independent tasks for a single person)
3. [ ] Identify decision points (YES_NO branches)
4. [ ] Search for relevant images (Pexels/Unsplash) for visual context
5. [ ] Check for videos referenced in the procedure
6. [ ] Define text input fields for every measurement or observation to record
7. [ ] Calculate content heights and mark steps that need auto-splitting
8. [ ] Verify every YES_NO has a WAIT ANY convergence point
9. [ ] Verify every PARALLEL has a matching WAIT_ALL
10. [ ] Ensure START and END nodes exist
11. [ ] Run the script and verify the ZIP can be imported

---

## 15. Common Patterns

### Inspection with Measurement Recording

```
[Instruction: what to inspect + image] → [Record: measurements via text inputs]
```

### Conditional Follow-Up

```
[Observe condition] → [YES_NO: issue found?]
  YES → [Remediation step] → [WAIT ANY]
  NO  → [WAIT ANY]
[Continue...]
```

### Parallel Area Inspections

```
[PARALLEL]
  Branch 1: [Area A steps...]
  Branch 2: [Area B steps...]
[WAIT_ALL]
```

### Multi-Step Recording (auto-split produces this)

```
[Instruction + Next button] → [Record: fields 1-6] → [Record: fields 7-12]
```
