# Mission Designer — Project Specification

**Version:** 1.8.0
**Schema Version:** 4.0
**Last Updated:** 2026-03-12
**License:** Apache License, Version 2.0

---

## 1. Product Overview

Mission Designer is a web application for creating and managing workflow specifications for the Trajectory distributed workflow ecosystem. Workflow creators use this site to author Master Actions, Environments, Workflow Steps, and Workflows — including WYSIWYG form layouts for user-facing steps — that can be exported and executed on Trajectory Pro runtime systems.

**Core Value:** Workflow creators can visually design, organize, and export workflow specifications that conform to the Trajectory JSON schema standard.

**Product Vision:** Trajectory is a distributed workflow system where users author workflows on this web site, then download and execute them on mobile devices or enterprise systems. This site is the Master Data management component — the authoring environment.

### User Types

- **Action Creators:** Create Master Action Specifications and define input/output parameters
- **Workflow Creators:** Create Master Workflows using a visual editor, combining actions into executable sequences

### Milestones Shipped

| Milestone | Description                                                             | Shipped    |
| --------- | ----------------------------------------------------------------------- | ---------- |
| v1.0      | Canvas Editor — visual editor, multi-notation, library, auth, export    | 2026-02-02 |
| v2.0      | UI Step Types — 5 UI step types, parameter system, schema versioning    | 2026-02-09 |
| v3.0      | WYSIWYG User Interaction — form designer, multi-layout, ZIP export      | 2026-02-22 |
| v4.0      | Runtime Chrome & Cleanup — legacy removal, inline editing, chrome zones | 2026-02-28 |
| v5.0      | Parameter Mapping & Better Text Fields — rich text, timer, mobile specs | 2026-03-01 |

### Project Stats

| Metric                 | Value                  |
| ---------------------- | ---------------------- |
| Codebase               | ~34,000 LOC TypeScript |
| Source files           | ~265 TS/TSX files      |
| Automated tests        | 385                    |
| Phases completed       | 25                     |
| Plans executed         | 80                     |
| Requirements delivered | 214 + 19 (v5.0)        |

---

## 2. Technology Stack

### Frontend

| Technology             | Version  | Purpose                                 |
| ---------------------- | -------- | --------------------------------------- |
| React                  | 19.2.4   | UI framework                            |
| TypeScript             | 5.9.3    | Type-safe development                   |
| Vite                   | 7.3.1    | Build tool (ES modules)                 |
| Tailwind CSS           | 4.1.18   | Utility-first styling                   |
| @xyflow/react          | 12.10.0  | Workflow canvas (React Flow v12)        |
| Zustand                | 5.0.10   | State management                        |
| Zundo                  | 2.3.0    | Undo/redo temporal middleware           |
| @tanstack/react-router | 1.157.16 | File-based routing                      |
| Tiptap                 | 3.20.0   | Rich text editor (text/header elements) |
| @uiw/react-codemirror  | 4.25.4   | Script step code editor                 |
| React RND              | 10.5.2   | Draggable form elements                 |
| React Zoom Pan Pinch   | 3.7.0    | Canvas zoom/pan                         |
| Dagre                  | 0.8.5    | Auto-layout algorithms                  |
| Radix UI               | various  | Accessible UI primitives                |
| Lucide React           | 0.563.0  | Icons                                   |
| React Hook Form        | 7.71.1   | Form handling                           |
| Zod                    | 4.3.6    | Schema validation                       |
| JSZip                  | 3.10.1   | ZIP creation/extraction                 |
| AJV                    | 8.17.1   | JSON schema validation                  |
| React Colorful         | 5.6.1    | Color picker                            |
| Sonner                 | 2.0.7    | Toast notifications                     |

### Backend

| Technology  | Version | Purpose           |
| ----------- | ------- | ----------------- |
| Hono        | 4.11.7  | HTTP framework    |
| Better Auth | 1.4.18  | Authentication    |
| Drizzle ORM | 0.45.1  | Database ORM      |
| pg          | 8.22.0  | PostgreSQL driver |

### Development

| Technology | Version | Purpose                           |
| ---------- | ------- | --------------------------------- |
| Vitest     | 4.0.18  | Unit/integration testing (jsdom)  |
| Playwright | 1.58.2  | End-to-end testing                |
| ESLint     | —       | Linting                           |
| Prettier   | 3.8.1   | Code formatting                   |
| Husky      | 9.1.7   | Git hooks (pre-commit formatting) |

---

## 3. Architecture

### Source Organization

```
src/
├── assets/                  # Static images, SVGs
├── components/              # React components
│   ├── admin/               # Admin dashboard
│   ├── auth/                # Login/session
│   ├── canvas/              # Main canvas wrapper
│   ├── detail/              # Detail panel
│   ├── draft/               # Draft recovery UI
│   ├── edges/               # Custom edge renderers
│   ├── export/              # Export dialogs
│   ├── form-designer/       # WYSIWYG form designer (15 components)
│   │   ├── FormCanvas.tsx
│   │   ├── DeviceFrame.tsx / DesktopFrame.tsx
│   │   ├── ChromeOverlay.tsx / GridOverlay.tsx
│   │   ├── ElementLayer.tsx / ElementPalette.tsx
│   │   ├── FormDesignerModal.tsx / FormDesignerToolbar.tsx
│   │   ├── FormDesignerStatusBar.tsx / FormPreview.tsx
│   │   └── Inspector/ (ElementInspector, Inspector, etc.)
│   ├── import/              # Import dialog
│   ├── library/             # Library sidebar & search
│   ├── nodes/               # Node renderers
│   │   └── renderers/
│   │       ├── bpmn/        # BPMN notation
│   │       ├── flowchart/   # Standard flowchart
│   │       ├── isa88/       # ISA88 batch notation
│   │       ├── unified/     # Shared across notations (14 components)
│   │       └── shared/      # Shared utilities
│   ├── palette/             # Step palette
│   ├── properties/          # Right properties panel
│   ├── toolbar/             # Top toolbar
│   └── ui/                  # Radix UI primitives (11 components)
├── hooks/                   # Custom React hooks (8)
├── lib/
│   ├── export/              # Export pipeline (15 modules)
│   ├── import/              # Import pipeline (15 modules)
│   ├── form-designer/       # Layout utilities
│   └── schemas/             # JSON schema definitions (5 files)
├── routes/                  # TanStack Router pages
├── server/                  # Backend (Hono + Drizzle)
│   ├── db/                  # Database schema
│   ├── lib/                 # Auth, DB connection, seed
│   ├── middleware/           # Security headers, rate limiting
│   └── routes/              # API endpoints (5 route files)
├── stores/                  # Zustand stores
│   └── form-designer/       # Form designer store slices (4)
├── types/                   # TypeScript type definitions (6 files)
└── test-utils/              # Test utilities
```

### State Management

Five Zustand stores with distinct responsibilities:

| Store                     | Middleware                                 | Purpose                                                      |
| ------------------------- | ------------------------------------------ | ------------------------------------------------------------ |
| `useFlowStore`            | temporal (100-state) + persist (IndexedDB) | Workflow canvas: nodes, edges, parameters, resources, images |
| `useLibraryStore`         | persist (localStorage)                     | Libraries, specifications, entity type selection             |
| `useFormDesignerStore`    | temporal (independent)                     | WYSIWYG form elements, selection, clipboard, grid, layout    |
| `useNotationStore`        | persist (localStorage)                     | Diagram notation preference                                  |
| `useWorkflowSessionStore` | —                                          | Session-level transient state                                |

**Key patterns:**

- `workflow-coordination.ts` decouples flowStore and libraryStore (avoids circular imports)
- Form designer has independent undo/redo (drag events don't consume flowStore's 100-state limit)
- Images stored separately in `flowStore.images` (filename -> data URI), referenced by filename

### Routing

File-based routing via @tanstack/react-router:

| Route    | Component              | Access        |
| -------- | ---------------------- | ------------- |
| `/login` | Login page             | Public        |
| `/`      | Workflow editor (main) | Authenticated |
| `/admin` | Admin dashboard        | Authenticated |

### Authentication

- **Provider:** Better Auth with email/password
- **Storage:** PostgreSQL (user, session, account, verification tables)
- **Roles:** isAdministrator, isGlobal, isWorkflowAuthor, isStepLibraryAuthor, isEnvironmentAuthor, isActionAuthor
- **First-user promotion:** First registered user becomes admin

### Server API

| Endpoint         | Purpose                      |
| ---------------- | ---------------------------- |
| `/api/auth/*`    | Authentication (Better Auth) |
| `/api/libraries` | Library CRUD                 |
| `/api/workflows` | Workflow persistence         |
| `/api/users`     | User management              |
| `/api/admin`     | Admin endpoints              |
| `/api/backup`    | Backup/restore               |
| `/api/health`    | Health check                 |

**Middleware:** Security headers (CSP, HSTS), CORS, rate limiting (auth: 10/min, general: 100/min in production)

---

## 4. Data Model

### Workflow Step Types

11 internal node types mapping to 14 export schema step types:

| Internal NodeType     | Export StepType     | Description                                   |
| --------------------- | ------------------- | --------------------------------------------- |
| `start`               | `START`             | Workflow entry point, one outgoing connection |
| `end`                 | `END`               | Workflow exit point, one incoming connection  |
| `actionProxyWait`     | `WAIT ACTION PROXY` | Execute action, wait for completion           |
| `userInteractionStep` | `USER_INTERACTION`  | WYSIWYG form step with multi-device layouts   |
| `yesNoStep`           | `YES_NO`            | Binary selection with 2 required buttons      |
| `scriptStep`          | `SCRIPT`            | Python code editor via CodeMirror             |
| `workflowProxy`       | `WORKFLOW PROXY`    | Execute sub-workflow (embedded or referenced) |
| `select1`             | `SELECT 1`          | Multi-way conditional branching               |
| `waitAny`             | `WAIT ANY`          | Continue when any incoming path completes     |
| `parallel`            | `PARALLEL`          | Fork to multiple parallel paths               |
| `waitAll`             | `WAIT ALL`          | Synchronize all parallel paths                |

Additional export-only types: `ACTION PROXY`, `NOWAIT ACTION PROXY`, `MATH`.

### Step Node Data

Each workflow node carries a `StepNodeData` payload:

```typescript
interface StepNodeData {
  label: string // Display label
  stepType: NodeType // Visual rendering type
  description?: string // Documentation/tooltips
  inputs?: ParameterSpec[] // Input parameters
  outputs?: ParameterSpec[] // Output parameters
  values?: ValueSpec[] // Value properties
  resourceCommands?: StepResourceCommand[] // Resource acquire/release
  uiParameters?: UIParameterSpec[] // UI-specific parameters
  formLayouts?: FormLayouts // WYSIWYG form data (3 breakpoints)

  // Yes/No specific
  yesNoYesValue?: string // Default: "true"
  yesNoNoValue?: string // Default: "false"
  yesNoDefaultSelection?: 'yes' | 'no' | 'none'

  // Select 1 specific
  select1InputName?: string
  select1InputValueType?: 'literal' | 'property'
  select1Options?: Select1OptionSpec[]

  // Script specific
  scriptSource?: string
  scriptLanguage?: string

  // Action reference
  actionName?: string
  actionLibraryName?: string
  actionVisibility?: 'opaque' | 'observable'

  // Workflow proxy
  subWorkflowMode?: 'embedded' | 'reference'
  embeddedWorkflowSpecId?: string
  referencedStepSpecId?: string
  referencedStepName?: string

  // ISA88 specific
  isa88Width?: number
  isa88TargetHandles?: string[]
  isa88SourceHandles?: string[]
}
```

### Parameter System

```typescript
interface ParameterSpec {
  id: string
  name: string
  entries?: ValueEntrySpec[] // Structured data shape
  value?: string // Default/initial value
  valueType?: 'literal' | 'property'
  description?: string
  schema?: string // Optional JSON Schema
  target?: string // Value property target
}

interface ValueSpec {
  id: string
  name: string // e.g., "UserResponse"
  entries: ValueEntrySpec[] // Name/value pairs
}

interface ValueEntrySpec {
  id: string
  name: string
  value: string
}
```

Parameters use dot notation for referencing: `PropertyName.EntryName` (e.g., `UserResponse.Value`).

### Resource System

```typescript
type ResourceType = 'Single Use' | 'Shared Use' | 'Count Limited' | 'Named' | 'Sync'

interface ResourceSpec {
  id: string
  name: string
  description?: string
  resourceType: ResourceType
  count: number
  names?: string[] // Named pool only
}

type ResourceCommandType = 'Acquire' | 'Release' | 'Send' | 'Receive' | 'Synchronize'

interface StepResourceCommand {
  id: string
  resourceName: string
  commandType: ResourceCommandType
  count: number
  target?: string // Named type: value property for acquired name
  source?: string // Sync Send: data to send
}
```

### Select 1 Branching

```typescript
type Select1Operator = '==' | '!=' | '<' | '>' | '<=' | '>=' | 'Contains' | 'Not Contains'

interface Select1OptionSpec {
  id: string // Also serves as Handle ID and connection_id
  label: string
  operator: Select1Operator
  value: string
  valueType: 'literal' | 'property'
  isDefault: boolean
}
```

### Edge Data

```typescript
interface ConditionalEdgeData {
  condition?: string
  waypoints?: Array<{ x: number; y: number }>
  connectionId?: string // Matches Select1OptionSpec.id
}
```

---

## 5. WYSIWYG Form Designer

### Form Element Types

11 element types in a discriminated union (`FormElementSpec`):

| Type      | Discriminant | Purpose                      | Key Properties                                                                             |
| --------- | ------------ | ---------------------------- | ------------------------------------------------------------------------------------------ |
| Button    | `button`     | Tappable action button       | label, outputValue, deletable?                                                             |
| Text      | `text`       | Static text (rich text HTML) | content, fontSize?, fontWeight?, color?, align?                                            |
| Header    | `header`     | Large title (rich text HTML) | content, fontSize?, fontWeight?, color?, align?                                            |
| TextInput | `textInput`  | Single-line input            | label?, placeholder?, fieldName, required?, outputParameter?, defaultSource?, fontSize?    |
| Textarea  | `textarea`   | Multi-line input             | label?, placeholder?, fieldName, required?, outputParameter?, defaultSource?, rows?        |
| Image     | `image`      | Image display                | src, imageOid?, objectFit?                                                                 |
| Video     | `video`      | Video player (https:// only) | src, posterUrl?                                                                            |
| Checkbox  | `checkbox`   | Checkbox group               | label?, fieldName, options[], fontSize?, required?, outputParameter?                       |
| Radio     | `radio`      | Radio button group           | label?, fieldName, options[], fontSize?, required?, outputParameter?                       |
| Divider   | `divider`    | Horizontal separator         | thickness?, color?                                                                         |
| Timer     | `timer`      | Countdown/countup timer      | label, fieldName, durationSeconds, direction, blockDone?, outputParameter?, defaultSource? |

All elements share a `FormElementBase`:

```typescript
interface FormElementBase {
  id: string // Snowflake OID
  x: number // Logical pixels from left
  y: number // Logical pixels from top
  width: number // Logical pixels
  height: number // Logical pixels
  zIndex?: number // Stacking order
}
```

### Multi-Device Layout System

Three independent layouts, one per device breakpoint:

| Breakpoint | Canvas Width | Canvas Height |
| ---------- | ------------ | ------------- |
| Phone      | 390          | 844           |
| Tablet     | 768          | 1024          |
| Desktop    | 1280         | 800           |

```typescript
interface FormLayouts {
  phone: FormLayout
  tablet: FormLayout
  desktop: FormLayout
}

interface FormLayout {
  canvasWidth: number
  canvasHeight: number
  elements: FormElementSpec[]
}
```

**Design principles:**

- Phone-first design with auto-generated tablet/desktop layouts
- Synced properties (type, label, required) apply to all layouts
- Positional properties (x, y, width, height) are layout-specific
- `scaleElement()` for proportional scaling, `nudgeCollisions()` for overlap resolution

### Runtime Chrome Zones

Reserved screen areas for runtime navigation:

| Device  | Top Chrome | Bottom Chrome |
| ------- | ---------- | ------------- |
| Phone   | 15%        | 10%           |
| Tablet  | 10%        | 10%           |
| Desktop | 10%        | 8%            |

Drop rejection and drag/resize clamping enforce chrome zone boundaries.

### Parameter Binding

Text inputs and textareas support parameter mapping:

```typescript
type ParameterDefaultSource =
  | { mode: 'static'; value: string } // Fixed literal default
  | { mode: 'property'; value: string } // Value Property reference (name.key)
  | { mode: 'input'; value: string } // Input parameter reference (name.key)
```

- `outputParameter`: name.key where field's runtime value is captured
- `defaultSource`: Source for pre-populating the field at runtime

### Rich Text Content

Text and Header elements store content as HTML:

- Formatting via Tiptap v3 (bold, italic, underline, font family/size/color)
- Parameter placeholders embedded as `<name.key>` syntax, rendered as inline atom nodes (`data-param-chip`)
- Exported as `{ content: string, plainText: string }` (RichTextContent)
- `stripHtmlToPlainText` uses NUL-placeholder pattern to protect `<name.key>` from HTML stripping

---

## 6. Diagram Notations

Three diagram styles with separate renderer components:

| Notation  | Layout Direction   | Style                               |
| --------- | ------------------ | ----------------------------------- |
| Flowchart | Top-to-bottom (TB) | Standard flowchart shapes           |
| BPMN      | Left-to-right (LR) | Business Process Model and Notation |
| ISA88     | Top-to-bottom (TB) | ISA-88 Procedural Function Chart    |

14 unified node renderer components shared across all notations, with notation-specific renderers for visual differences.

ISA88 features dynamic handles for WAIT_ANY/WAIT_ALL/PARALLEL nodes and persisted horizontal width.

---

## 7. Export/Import System

### Schema Version

Current: `"4.0"` (literal type). Migration path: v1 -> v2 -> v3 -> v4.

### Export Package Format (`.WFmasterX`)

A `.WFmasterX` file is a ZIP archive:

| ZIP Path                  | Content                              |
| ------------------------- | ------------------------------------ |
| `manifest.json`           | Package metadata                     |
| `{WorkflowName}.WFmaster` | Workflow JSON (schemaVersion: "4.0") |
| `images/{filename}`       | Referenced images                    |

**Manifest structure:**

```json
{
  "packageVersion": "1.0",
  "workflowName": "string",
  "environmentLibraries": ["string"],
  "actionLibraries": ["string"],
  "files": [{ "path": "string", "type": "workflow|environment|action|image" }],
  "createdAt": "ISO 8601"
}
```

### Export Schema

```typescript
interface MasterWorkflowSpecification extends ManagedElement {
  schemaVersion?: '4.0'
  steps: MasterWorkflowStep[]
  connections: WorkflowConnection[]
  resource_command_specifications?: ResourceCommandSpecification[]
  resource_property_specifications?: ResourcePropertySpecification[]
  value_property_specifications?: PropertySpecification[]
  starting_parameter_specifications?: ParameterSpecification[]
  output_parameter_specifications?: OutputParameterSpecification[]
  environment_specifications?: MasterEnvironmentSpecification[]
  child_workflows?: MasterWorkflowSpecification[]
  viewport?: { x: number; y: number; zoom: number }
}

interface ManagedElement {
  local_id: string
  oid: string
  description?: string
  version: string
  last_modified_date: string
}

interface WorkflowConnection {
  from_step_id: string
  to_step_id: string
  condition?: string
  connection_id?: string
  source_handle_id?: string
  waypoints?: Array<{ x: number; y: number }>
}
```

### Image Handling

- Stored in `flowStore.images` map (filename -> data URI)
- Form element images use `{stepOid}-{filename}` namespacing in ZIP to avoid collision
- Image elements with `imageOid` preserve references across exports

### Export Pipeline (`src/lib/export/`)

1. `entity-converters.ts` — Flow nodes -> Trajectory schema
2. `parameter-extractors.ts` — Extract parameter specifications
3. `step-extractors.ts` — Convert step configs (Yes/No, Script, Select1, form layouts)
4. `image-collectors.ts` — Gather referenced images
5. `workflow-exporters.ts` — Assemble workflow JSON
6. `library-exporters.ts` — Export library hierarchies
7. `workflow-zip.ts` — Package as ZIP
8. `runtime-package.ts` — Runtime package creation
9. `workflow-library-package.ts` — Full library package

### Import Pipeline (`src/lib/import/`)

1. `schema-validator.ts` — AJV JSON schema validation
2. `legacy-detection.ts` — Detect pre-v4.0 formats
3. `type-mapping.ts` — Map Trajectory schema -> internal types
4. `transformers.ts` — Transform step specs -> nodes
5. `form-layout-hydration.ts` — Regenerate form layout IDs, strip stepOid prefixes
6. `workflow-importers.ts` — Create nodes/edges from JSON
7. `workflow-zip.ts` — Unzip and extract

---

## 8. Library System

### Entity Types

| Type        | Library                      | Specification                    |
| ----------- | ---------------------------- | -------------------------------- |
| Workflow    | Master Workflow Library      | Master Workflow Specification    |
| Step        | Master Workflow Step Library | Master Workflow Library Step     |
| Environment | Master Environment Library   | Master Environment Specification |
| Action      | Master Action Library        | Master Action Specification      |

### Library Structure

```typescript
interface Library {
  id: string
  userId: string
  parentLibraryId?: string | null // Nested libraries
  name: string
  entityType: 'workflow' | 'step' | 'environment' | 'action'
  description?: string | null
  author?: string | null
  changeHistory?: string | null
  environmentLibraryIds?: string[] | null
  isShared?: boolean
  createdAt: number
  updatedAt: number
}

interface Specification {
  id: string
  libraryId: string
  name: string
  description: string | null
  data: Record<string, unknown> // JSON blob
  environmentLibraryIds?: string[] | null
  createdAt: number
  updatedAt: number
}
```

Libraries support nesting (parent/child) and tree-based navigation in the left sidebar.

### JSON Schema Definitions

Located in `src/lib/schemas/`:

- `managed-element.json` — Base element structure (local_id, oid, version, last_modified_date)
- `master-action-library.json` — Action library catalog
- `master-environment-library.json` — Environment library catalog
- `master-workflow-library.json` — Workflow library catalog
- `master-workflow-step-library.json` — Step library catalog

Full JSON Schema (Draft-07) documentation: `JSONSpec.md` (59KB)

---

## 9. Database Schema

Key tables in PostgreSQL via Drizzle ORM:

| Table           | Purpose                                                               |
| --------------- | --------------------------------------------------------------------- |
| `user`          | Authentication + role flags (isAdministrator, isWorkflowAuthor, etc.) |
| `session`       | Active sessions with tokens and expiry                                |
| `account`       | OAuth/provider accounts                                               |
| `verification`  | Email/OTP verification                                                |
| `library`       | Library entities (workflow, step, environment, action)                |
| `specification` | Specifications within libraries (data as JSON blob)                   |

---

## 10. Testing

### Framework

- **Unit/Integration:** Vitest 4.0.18 + jsdom environment
- **E2E:** Playwright 1.58.2
- **Coverage:** @vitest/coverage-v8

### Test Distribution (17 files, 385 tests)

| Area          | Files | Location                                                                        |
| ------------- | ----- | ------------------------------------------------------------------------------- |
| Hooks         | 3     | `src/hooks/__tests__/` (autoLayout, copyPaste, undoRedo)                        |
| Lib/Snowflake | 1     | `src/lib/__tests__/snowflake.test.ts`                                           |
| Export        | 2     | `src/lib/export/__tests__/` (form-layout, workflow-zip)                         |
| Import        | 2     | `src/lib/import/__tests__/` (form-layout, workflow-zip)                         |
| Components    | 1     | `src/components/palette/__tests__/StepPalette.test.ts`                          |
| Stores        | 3     | `src/stores/__tests__/` (flowStore, formDesignerStore, libraryStore)            |
| Server Routes | 5     | `src/server/routes/__tests__/` (backup, multiuser, libraries, users, workflows) |

### Commands

```bash
npm test              # Watch mode
npm run test:run      # Single run
npm run test:coverage # Coverage report
npm run test:ui       # Vitest UI
npm run test:e2e      # Playwright E2E
```

---

## 11. Build & Development

### Scripts

```bash
npm run dev           # Vite dev server (localhost:5173)
npm run dev:all       # Backend + frontend concurrently
npm run build         # TypeScript check + Vite production build
npm run server        # Backend dev server (localhost:3000)
npm run db:push       # Apply Drizzle migrations
npm run db:studio     # Drizzle Studio database UI
```

### Configuration

- **Vite:** React SWC + Tailwind CSS + TanStack Router auto code-splitting
- **TypeScript:** ES2020 target, ESNext modules, strict mode, `@/` path alias
- **Dev proxy:** `/api` -> `http://localhost:3000`
- **Docker:** `DOCKER_DEV` env var enables polling for file watching

---

## 12. Workflow Generation

A script-based system for generating `.WFmasterX` packages from procedure descriptions.

### Generator Scripts

Scripts in `scripts/` produce importable ZIP files in `test-data/`:

| Script                              | Output                               | Description                                |
| ----------------------------------- | ------------------------------------ | ------------------------------------------ |
| `generate-vrf-inspection.mjs`       | VRF Heat Pump Inspection.WFmasterX   | Multi-step inspection with YES_NO branches |
| `generate-lawnmower-inspection.mjs` | Lawnmower Inspection.WFmasterX       | Equipment inspection with measurements     |
| `generate-bolognese.mjs`            | Spaghetti Bolognese Dinner.WFmasterX | Sequential recipe workflow                 |
| `generate-test-data.mjs`            | Phase 4 testing.WFmasterX            | General test workflow                      |

### Generation Rules

- Full specification: `docs/workflow-generation-spec.md`
- Auto-split long steps: content > 550px splits into instruction + recording screens
- Optimize for parallelism: independent steps wrapped in PARALLEL/WAIT_ALL
- Images sourced from Pexels; omit rather than use irrelevant images
- Video URLs embedded as `video` form elements when referenced
- Every measurement/observation gets a `textInput` field
- Reference template: `scripts/generate-vrf-inspection.mjs`

---

## 13. Known Tech Debt

| Item                                                     | Severity | Notes      |
| -------------------------------------------------------- | -------- | ---------- |
| formTitle not in export schema (lost on round-trip)      | Medium   | v3.0 audit |
| createRuntimePackage missing form element images         | Medium   | v3.0 audit |
| TextInputElement/TextareaElement lack defaultValue field | Low      | Phase 13   |
| TextElement/HeaderElement lack fontStyle (italic)        | Low      | Phase 13   |

---

## 14. Deferred Requirements

Deferred from v4.0 to future milestones:

- **Environment Action Properties** (ENV-01 through ENV-04): Action Properties section in Environment editor
- **Sync Resource** (SYNC-01 through SYNC-10): Sync resource type with SEND/RECEIVE/SYNCHRONIZE commands
- **Runtime Chrome Content** (CHROME-F01, CHROME-F02): Top area step context display and chrome toggle

---

## 15. Constraints

- **Deployment:** Must support both cloud and self-hosted deployment
- **Schema compliance:** JSON import/export must follow schemas defined in JSONSpec.md exactly
- **Diagram fidelity:** All three visualization styles (Flowchart, BPMN, ISA88) required with correct symbols
- **Browser support:** Modern browsers (Chrome, Firefox, Safari, Edge)

---

## 16. Key Architectural Decisions

| Decision                                                   | Rationale                                                               | Outcome |
| ---------------------------------------------------------- | ----------------------------------------------------------------------- | ------- |
| DOM-based form canvas (react-rnd + react-zoom-pan-pinch)   | Canvas libs can't render real form controls; DOM serializes trivially   | Good    |
| Separate formDesignerStore with own temporal               | Prevents drag micro-events from consuming workflow undo limit           | Good    |
| Three independent FormLayouts in StepNodeData              | Phone/tablet/desktop each store own element arrays                      | Good    |
| ZIP export with stepOid-namespaced form images             | Prevents collision with UI parameter images                             | Good    |
| Remove all legacy UI step types in v4.0                    | Clean slate — no backward compat, no dead code                          | Good    |
| Runtime navigation chrome in form designer                 | Shows creators what runtime app looks like                              | Good    |
| Inline properties editing (no modals)                      | Faster workflow, fewer clicks                                           | Good    |
| Tiptap v3 for rich text                                    | StarterKit includes Underline; `undoRedo: false` (not `history: false`) | Good    |
| Parameter chips as Tiptap atom nodes                       | `data-param-chip` attribute; CSS `::before` shows text in read mode     | Good    |
| Timer uses isTimer flag (not in DATA_TYPES/NON_DATA_TYPES) | Consistent with isButton and isDivider pattern                          | Good    |
| `workflow-coordination.ts` for cross-store actions         | Prevents circular import chains between flowStore/libraryStore          | Good    |
| onBlur (not onChange) for parameter binding inputs         | Prevents cursor-loss during typing                                      | Good    |

---

## 17. Reference Documents

| Document                  | Location                                  | Description                                          |
| ------------------------- | ----------------------------------------- | ---------------------------------------------------- |
| JSON Schema Specification | `JSONSpec.md` (59KB)                      | Complete JSON Schema (Draft-07) for all entity types |
| Master Data Specification | `MasterDataSpec.md` (78KB)                | High-level data model and ecosystem architecture     |
| Workflow Generation Spec  | `docs/workflow-generation-spec.md` (21KB) | Script-based workflow generation guide               |
| Parameter Mapping Spec    | `docs/specs/ParameterMappingSpec.md`      | Mobile runtime parameter mapping behavior            |
| Rich Text Rendering Spec  | `docs/specs/RichTextRenderingSpec.md`     | Mobile runtime rich text and placeholder rendering   |
| Timer Element Spec        | `docs/specs/TimerElementSpec.md`          | Mobile runtime timer behavior                        |

---

## 18. Out of Scope

| Feature                          | Reason                                      |
| -------------------------------- | ------------------------------------------- |
| Real-time collaborative editing  | Single editor at a time sufficient          |
| Trajectory Pro runtime execution | Separate system                             |
| Runtime Action Realizations      | Manages specifications, not executable code |
| OAuth/SSO authentication         | Email/password sufficient for internal team |
| Workflow execution/testing       | Authoring only                              |
