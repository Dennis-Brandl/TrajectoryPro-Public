# PDF Export Specification

## Overview

Mission Designer exports PDF documents for two categories:

1. **Workflow PDFs** — workflow specification with diagram, step details, and child workflows
2. **Library PDFs** — action, environment, and step library specifications

All pages are **portrait letter** (8.5" x 11", 612 x 792 pt). No landscape pages.

---

## 1. Technology Stack

| Component        | Library                   | Purpose                                                     |
| ---------------- | ------------------------- | ----------------------------------------------------------- |
| PDF engine       | `jspdf`                   | Document creation, text, images, page management            |
| Tables           | `jspdf-autotable`         | Data tables with auto-pagination                            |
| DOM capture      | `html-to-image` (`toPng`) | Capture React Flow viewport as PNG                          |
| Canvas minimap   | HTML Canvas API           | Render simplified workflow diagrams from raw node/edge data |
| Topological sort | Custom BFS                | Order steps from START node following edges                 |

### Known jsPDF Issues

- **Blank page bug**: `doc.addPage('letter', 'portrait')` with string format causes blank pages during orientation switches. Always use `doc.addPage([612, 792])` with explicit `[width, height]` arrays.
- **autotable silent pages**: `jspdf-autotable` may silently add a page when a table overflows. The code must account for this — do not blindly add a page after rendering a table without checking current page state.
- **Landscape pages are unreliable** in jsPDF when mixed with portrait pages. This spec mandates portrait-only to avoid this class of bugs entirely.

---

## 2. Page Layout Constants

```
Page:       612 x 792 pt (letter)
Margins:    36 pt (0.5") all sides
Print area: 540 x 720 pt
```

### Typography

| Token           | Size (pt) | Usage                             |
| --------------- | --------- | --------------------------------- |
| TITLE           | 12        | Spec name, step name              |
| SECTION_HEADER  | 12        | Section labels (bold)             |
| BODY            | 10        | Description text, general content |
| TABLE_CELL      | 10        | Table cell text                   |
| TABLE_HEADER    | 10        | Table header text (bold)          |
| STEP_TYPE_LABEL | 8         | Step type + OID meta line         |
| META            | 8         | Version, date, OID, subtitle      |
| FOOTER          | 8         | Page footer                       |
| CODE            | 8         | Script source code (monospace)    |
| CONTINUATION    | 8         | "...continued" markers            |
| YOU_ARE_HERE    | 6         | Minimap thumbnail caption         |

### Colors

| Token           | Hex     | Usage                                          |
| --------------- | ------- | ---------------------------------------------- |
| BLACK           | #000000 | Primary text                                   |
| GRAY_DARK       | #666666 | Meta text, labels                              |
| GRAY_MID        | #999999 | Footer text                                    |
| TABLE_HEADER_BG | #F0F0F0 | Table header fill                              |
| CODE_BG         | #F5F5F5 | Script code background                         |
| ORANGE          | #E87A1E | "You are here" highlight, continuation markers |
| BORDER_LIGHT    | #CCCCCC | Table borders, thumbnail borders               |

### Spacing

| Token              | Value  | Usage                           |
| ------------------ | ------ | ------------------------------- |
| LINE_HEIGHT        | 1.15   | Multiplier for font size        |
| SECTION_GAP_BEFORE | 10 pt  | Above a section header          |
| SECTION_GAP_AFTER  | 3 pt   | Below a table / section content |
| TABLE_GAP          | 2 pt   | Between header label and table  |
| CELL_PADDING_V     | 4 pt   | Table cell vertical padding     |
| CELL_PADDING_H     | 6 pt   | Table cell horizontal padding   |
| PAGE_MARGIN        | 36 pt  | Page margins (all sides)        |
| CELL_BORDER        | 0.5 pt | Table cell border width         |

---

## 3. Workflow PDF Structure

A workflow PDF contains these sections in order:

### 3.1 Cover Page (page 1)

Content flows top-to-bottom on the first page:

1. **Branding line**: "MISSION DESIGNER" — META size, GRAY_DARK
2. **Workflow name**: TITLE size, bold
3. **Meta line**: "Version 1.0.0 | 2026-03-12 | OID: abc-123" — META size, GRAY_DARK
4. **Subtitle**: "Workflow Specification" — META size, GRAY_DARK
5. **Description** (if present): BODY size, word-wrapped to page width
6. **Input Parameters table** — labeled table, shows "None" if empty
7. **Output Parameters table** — labeled table, shows "None" if empty
8. **Value Properties table** — labeled table, shows "None" if empty
9. **Resources table** — labeled table, shows "None" if empty

Tables use `jspdf-autotable` with grid theme. If content exceeds page, autotable handles pagination automatically.

### 3.2 Workflow Diagram (portrait pages)

**Main workflow**: DOM capture via `exportToPng` from the React Flow viewport.

- Captures at 3840px width, height proportional to node bounds aspect ratio
- The captured image is a true representation of the on-screen workflow diagram

**Child workflows**: Cannot use DOM capture (nodes are not rendered in React Flow). Child workflows skip the full-page diagram entirely. Spatial context is provided via canvas minimap thumbnails on each step detail page.

#### Diagram Page Layout

The diagram image is placed on portrait page(s) starting at the top margin.

**Sizing strategy**:

- Scale image to fill the portrait print area width (540 pt)
- If the scaled height fits within the print area height (720 pt): place on a single page
- If the scaled height exceeds the print area: paginate into vertical strips

**Pagination approach**:

- Slice the image into horizontal strips, each strip fitting the full page width
- Each strip fills one page
- **Continuation markers**: orange italic text centered at bottom ("...continued on next page") and top ("...continued from previous page") of multi-page diagrams
- Small label at top of each diagram page: "WORKFLOW DIAGRAM — {name}" in META size, GRAY_DARK, bold

**BPMN consideration**: BPMN workflows are horizontally oriented (left-to-right). When scaled to portrait page width, they become short and wide — typically fitting on a single page. Very large BPMN diagrams may still need pagination.

### 3.3 Step Detail Pages (one per step)

Each non-trivial step gets its own portrait page. Empty control steps (start, end, parallel, waitAll, waitAny with no parameters) are grouped separately.

#### Step Detail Page Layout

**Top section** (side-by-side):

- **Left**: Step name (TITLE, bold), word-wrapped to leave room for thumbnail
- **Below name**: "Type: ACTION PROXY | OID: abc-123" — STEP_TYPE_LABEL, GRAY_DARK, bold
- **Below type**: Description text (BODY, if present)
- **Right**: "You Are Here" minimap thumbnail (120 x 90 pt), top-right corner

**Below top section** (ensure Y is below thumbnail + 10pt):

- **Input Parameters** table (if non-empty)
- **Output Parameters** table (if non-empty)
- **Resource Commands** table (if non-empty)

**Step-type-specific content**:

| Node Type             | Content                                               |
| --------------------- | ----------------------------------------------------- |
| `userInteractionStep` | Phone Form Layout section (element listing)           |
| `yesNoStep`           | Phone Form Layout + Yes/No Configuration table        |
| `scriptStep`          | Script Source code block (monospace, gray background) |
| `select1`             | Input name/type + Select 1 Options table              |
| `actionProxyWait`     | Action name, library, visibility                      |
| `workflowProxy`       | Mode, referenced step name                            |
| Other (math, etc.)    | Parameters only (already rendered above)              |

#### "You Are Here" Minimap Thumbnail

Generated by the **canvas minimap renderer** (`pdf-canvas-minimap.ts`):

- 800 x 600 px canvas, exported as PNG data URL
- Draws simplified shapes from raw node position/dimension data
- Works for all workflow levels (parent + child) — does NOT depend on React Flow DOM
- Current step is highlighted with an orange overlay (baked into the image)
- Edges use orthogonal routing (right-angle connectors)
- Notation-aware: BPMN uses horizontal-first routing, flowchart/ISA88 uses vertical-first
- Placed at 120 x 90 pt in the top-right corner with a light border
- Caption "^ you are here" in 6pt orange bold below the thumbnail

#### Phone Form Layout Section

Lists form elements in top-to-bottom order (sorted by Y position). Each element is rendered as a single text line with a type label prefix:

```
[Header] Welcome to the Inspection
[Text] Please complete all fields below
[Text Input] Temperature Reading *
[Checkbox] Items Checked: Item A, Item B, Item C
[Radio] Condition: Good, Fair, Poor
[Image] photo-001.jpg
[Video] https://example.com/video.mp4
[Timer] Countdown — 05:00 up
[Button] Submit
--- (divider)
```

Required fields are marked with `*`. Rich text content (HTML) is stripped to plain text.

**Note**: A DOM-based form capture module (`pdf-form-capture.ts`) exists but produces unreliable blank images. The text-based listing is the primary approach. The DOM capture module is retained but not used in the main flow.

#### Control Step Groups

Empty control steps are grouped at the end, up to 6 per page. Each shows:

- Step name (BODY, bold) — inline with type and OID

### 3.4 Child Workflow Sections

For each child workflow (found via `parentSpecificationId` linkage):

1. New page with cover header: name, "Child Workflow Specification", version, OID, date, description
2. Property tables (inputs, outputs, values, resources)
3. **No full-page diagram** (not available without React Flow DOM)
4. Step detail pages (same format as parent, with canvas minimap thumbnails)

Child workflows are discovered recursively — grandchild workflows are included too. A visited set prevents infinite loops.

---

## 4. Library PDF Structure

### 4.1 Action Library PDF

- Cover header: library name, "Action Library Specification", version, OID, date, description
- For each action specification:
  - Spec name (SECTION_HEADER, bold)
  - Meta line: OID, version, visibility
  - Description
  - Input Parameters table
  - Output Parameters table
  - Value Properties table
  - Horizontal rule separator
- `ensureSpace` checks before each spec to avoid orphaned headers

### 4.2 Environment Library PDF

- Cover header: library name, "Environment Library Specification", version, OID, date, description
- Each environment spec starts on a new page (except first, which follows cover)
- For each environment specification:
  - Spec name, meta line, description
  - Included Actions table (action name + library)
  - Value Properties table
  - Action Properties table
  - Resources table
  - Horizontal rule separator

### 4.3 Step Library PDF

- Cover header: library name, "Step Library Specification", version, OID, date, description
- Converts spec data to WorkflowNode format
- Renders step detail pages using the same renderer as workflow PDFs
- No "You Are Here" thumbnails (no workflow context)
- Uses `'flowchart'` as default notation

---

## 5. Canvas Minimap Renderer

**File**: `pdf-canvas-minimap.ts`

Renders simplified workflow diagrams onto an HTML Canvas. Used for:

- "You Are Here" thumbnails on step detail pages (all workflow levels)

### Node Shapes

| Node Types                                  | Shape             | Dimensions                                  |
| ------------------------------------------- | ----------------- | ------------------------------------------- |
| `start`, `end`                              | Circle            | 30 x 30 px (fixed)                          |
| `select1`, `waitAny`, `parallel`, `waitAll` | Diamond           | From notation config `gateway.width/height` |
| All others (action, step, script, etc.)     | Rounded rectangle | From notation config `rect.width/height`    |

### Node Colors

| Node Type             | Fill          | Stroke              |
| --------------------- | ------------- | ------------------- |
| `start`               | START_FILL    | START_COLOR (green) |
| `end`                 | END_FILL      | END_COLOR (red)     |
| `select1`, `waitAny`  | GATEWAY_FILL  | GATEWAY_AMBER       |
| `parallel`, `waitAll` | PARALLEL_FILL | PARALLEL_PURPLE     |
| `scriptStep`          | white         | SCRIPT_AMBER        |
| Others                | white         | DEFAULT_STROKE      |

### Edge Rendering

- Orthogonal (right-angle) routing
- BPMN: horizontal first, then vertical (midpoint X)
- Flowchart/ISA88: vertical first, then horizontal (midpoint Y)
- Small filled arrowhead at target end
- Color: `#94a3b8` (slate-400)

### Highlight

The currently highlighted node gets an orange overlay:

- Semi-transparent fill: `rgba(232, 122, 30, 0.35)`
- Orange stroke: `#E87A1E`
- Padded slightly larger than the node shape

### Viewport Transform

- Computes bounding box of all nodes
- Fits to 800 x 600 canvas with 40px padding
- Centers the diagram in the canvas

---

## 6. Supporting Utilities

### Topological Sort (`topological-sort.ts`)

BFS from START node following edges. Falls back to zero-in-degree nodes if no START. Unreachable nodes appended at end.

### DOM Capture (`image-export.ts`)

`exportToPng(nodes, options)` — captures the React Flow `.react-flow__viewport` element:

- Computes viewport transform to fit all nodes
- Uses `html-to-image` `toPng` with custom styling
- Filters out non-exportable elements (minimap, controls, etc.)
- Only works for the **main** workflow (currently rendered in the DOM)

### Page Management (`pdf-export.ts`)

- `createPDFDocument()` — creates jsPDF instance (portrait, pt, letter)
- `addPortraitPage(doc)` — adds page using `[612, 792]` array format, returns top margin Y
- `ensureSpace(doc, y, needed)` — checks if `needed` pts fit; adds page if not
- `renderCoverHeader(doc, options)` — renders branding + title + meta + subtitle + description
- `renderSectionHeader(doc, text, y)` — renders bold section header
- `stampPageFooters(doc, specName)` — stamps all pages with "Mission Designer — {name}" and "Page X of Y"
- `downloadPDF(doc, filename)` — triggers browser download

### Table Builders (`pdf-tables.ts`)

Pure functions that return `{ head: string[][], body: string[][] }`:

- `buildInputParamsTable(params, level)` — columns vary by level (workflow/step/action)
- `buildOutputParamsTable(params, level)`
- `buildValuePropertiesTable(values)`
- `buildResourcesTable(resources)`
- `buildResourceCommandsTable(commands)`

Rendering functions:

- `renderTable(doc, tableData, startY)` — renders with autotable, returns `finalY`
- `renderLabeledTable(doc, label, tableData, startY, options)` — header + table, optional "None" for empty

---

## 7. File Map

```
src/lib/export/pdf/
├── pdf-types.ts            # Constants (fonts, colors, spacing, page), interfaces
├── pdf-export.ts           # Core utilities (page mgmt, headers, footers, download)
├── pdf-tables.ts           # Table data builders + autotable renderers
├── pdf-diagram.ts          # Diagram strategy, strip slicing, diagram page rendering
├── pdf-canvas-minimap.ts   # Canvas-based minimap renderer (shapes, edges, highlight)
├── pdf-step-pages.ts       # Step detail pages, form element listing, control groups
├── pdf-workflow.ts         # Workflow PDF orchestrator (main + child workflows)
├── pdf-libraries.ts        # Library PDF orchestrators (action, environment, step)
├── pdf-form-capture.ts     # DOM-based form capture (retained but unused — unreliable)
├── topological-sort.ts     # BFS topological sort for step ordering
└── __tests__/
    └── topological-sort.test.ts
```

### Entry Points

| Export Type  | Triggered From                              | Function                       |
| ------------ | ------------------------------------------- | ------------------------------ |
| Workflow PDF | `CanvasToolbar.tsx` → `handleExportPDF`     | `generateWorkflowPDF(options)` |
| Library PDF  | `use-library-export.ts` → `handleExportPDF` | `generateLibraryPDF(options)`  |

Both show a loading toast ("Generating PDF...") during generation, updated to success/error on completion.

---

## 8. Data Flow

### Workflow PDF

```
CanvasToolbar.handleExportPDF()
  ├── Read flowStore: nodes, edges, inputs, outputs, values, resources, images
  ├── Read libraryStore: spec name, description, dates
  ├── Read notationStore: current notation (flowchart/bpmn/isa88)
  ├── Load all workflow library specs (for child workflow discovery)
  ├── Collect images from spec data + child specs + flowStore
  └── generateWorkflowPDF(options)
        ├── renderMainWorkflowSection()
        │     ├── renderCoverHeader() — cover page
        │     ├── renderCoverTables() — property tables
        │     ├── exportToPng() — DOM capture of React Flow viewport
        │     ├── determineDiagramStrategy() + renderDiagramPages() — diagram pages
        │     ├── topologicalSort() — order steps
        │     └── renderStepPages() — step detail pages
        ├── renderChildWorkflows() — recursive
        │     ├── findChildWorkflowSpecs() — find by parentSpecificationId
        │     └── renderChildWorkflowSection() — cover + tables + step pages (no diagram)
        ├── stampPageFooters() — page numbers on all pages
        └── downloadPDF()
```

### Library PDF

```
useLibraryExport.handleExportPDF()
  ├── Read libraryStore: library, specs
  └── generateLibraryPDF(options)
        ├── Action → generateActionPDF(): cover + specs with tables
        ├── Environment → generateEnvironmentPDF(): cover + specs on separate pages
        └── Step → generateStepLibraryPDF(): cover + step detail pages
```

---

## 9. Notation Configurations

Three notation systems affect node dimensions and flow direction:

| Notation  | Flow Direction | Rect (W x H) | Gateway (W x H) |
| --------- | -------------- | ------------ | --------------- |
| Flowchart | Top → Bottom   | 120 x 50     | 60 x 60         |
| BPMN      | Left → Right   | 120 x 80     | 50 x 50         |
| ISA88     | Top → Bottom   | 140 x 60     | 60 x 60         |

Circle nodes (start/end) are always 30 x 30 regardless of notation.

---

## 10. Step Types Reference

| Node Type             | Step Type Label  | Has Form Layout | Special Content                    |
| --------------------- | ---------------- | --------------- | ---------------------------------- |
| `start`               | START            | No              | Control step (grouped)             |
| `end`                 | END              | No              | Control step (grouped)             |
| `actionProxyWait`     | ACTION PROXY     | No              | Action name, library, visibility   |
| `userInteractionStep` | USER_INTERACTION | Yes (phone)     | Form element listing               |
| `yesNoStep`           | YES_NO           | Yes (phone)     | Form listing + Yes/No config table |
| `scriptStep`          | SCRIPT           | No              | Code block (monospace)             |
| `workflowProxy`       | WORKFLOW PROXY   | No              | Mode, referenced step              |
| `select1`             | SELECT 1         | No              | Input + options table              |
| `waitAny`             | WAIT ANY         | No              | Control step (grouped)             |
| `parallel`            | PARALLEL         | No              | Control step (grouped)             |
| `waitAll`             | WAIT ALL         | No              | Control step (grouped)             |

---

## 11. Open Issues / Design Decisions for Next Session

1. **Child workflow full-page diagram**: Currently skipped because child workflow nodes are not in the React Flow DOM. The canvas minimap renderer exists and could be enhanced to produce a full-page diagram, but it renders simplified shapes rather than the true node rendering. Decide whether a canvas-rendered full-page diagram is acceptable or if an alternative approach is needed.

2. **Phone Form Layout visual rendering**: The DOM-based capture (`pdf-form-capture.ts`) exists but produces blank images. The text-based element listing works but lacks visual fidelity. Consider whether to fix the DOM capture or accept the text listing.

3. **BPMN diagram on portrait pages**: BPMN workflows are wide and short. When scaled to portrait width, the diagram becomes small with large whitespace below. Consider whether to rotate the image 90 degrees to use the full page height, or accept the smaller rendering.

4. **autotable page overflow**: When `jspdf-autotable` silently adds a page, subsequent explicit `addPortraitPage()` calls may create an empty page. Consider tracking the current page count before/after table rendering to detect and skip redundant page additions.
