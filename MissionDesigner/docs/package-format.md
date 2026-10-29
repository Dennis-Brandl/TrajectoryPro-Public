# Workflow Package Format (ZIP + JSON)

Reference for the Mission Designer workflow package — the `.WFmasterX` download and upload. The JSON shapes inside the package are specified in [`SCHEMA-SPECIFICATION.md`](../SCHEMA-SPECIFICATION.md); the suite-wide reference (every application's packages) is `docs/JSON_SCHEMA.md` at the root of the Trajectory Pro Mission Control repository.

## Overview

- **Container:** ZIP.
- **Envelope:** one recursive `MasterWorkflowSpecification` (the "v7.0" envelope) in a `.WFmaster` entry. The flat v3.0 envelope (`library` / `specifications` / `specEnvs` / `imageManifest`) is gone: it is neither written nor read.
- **Schema version:** export writes `schemaVersion: "5.0"`; import accepts `"4.0"` through `"5.0"` (file format; distinct from `dataSchemaVersion`, the per-spec payload version, currently `4`).
- **Download extension:** `.WFmasterX` (ZIP). The browser saves it as `{WorkflowName}({version}).WFmasterX`.
- **Envelope entry extension:** `.WFmaster` only (the bare `.json` envelope is no longer accepted).
- **Endpoints:**
  - Export: `GET /api/v2/packages/workflow/:rootSpecId`
  - Import: `POST /api/v2/packages/import` (multipart/form-data)

The same package is what Mission Commander loads into a work center.

## ZIP Layout

```
workflow.WFmasterX
├── <safeName>.WFmaster          # JSON envelope: the root MasterWorkflowSpecification
├── manifest.json                # package metadata (advisory; the importer skips it)
├── environments/
│   └── <EnvLibName>.WFenvir     # one MasterEnvironmentLibrary per environment library the workflow uses
├── actions/
│   └── <ActionLibName>.WFaction # one MasterActionLibrary per action library those environments use
└── images/
    ├── <imageOid>-<filename>    # form image blocks (prefix falls back to the step oid without an imageOid)
    └── <filename>               # Image UI parameters (bare)
```

Notes:

- `<safeName>` is the workflow name with every character outside `A–Z a–z 0–9 . _ -` replaced by `_` (at most 200 characters).
- Only the **first** entry ending in `.WFmaster` is parsed as the envelope.
- Image entries are resolved by bare filename, then `{specId}-{filename}`, then any entry ending in `-{filename}` (which covers `{imageOid}-{filename}`).
- Image MIME is verified by magic-byte sniff (`src/server/imageMime.ts`), not by filename extension.

## Envelope JSON

The `.WFmaster` entry is a `MasterWorkflowSpecification` (SCHEMA-SPECIFICATION.md §5), built by `exportWorkflowSpec` in `src/lib/packageFormat/workflow-exporters.ts`:

```ts
interface MasterWorkflowSpecification {
  schemaVersion: '5.0'
  local_id: string // workflow name
  oid: string // spec id
  description?: string
  type_name?: string // ISA 88 type, ≤ 50 characters; omitted when unset
  version: string
  state: string // Draft | InTest | InReview | Approved | Effective | Superseded | Obsolete
  last_modified_date: string // ISO 8601
  library_name?: string // the workflow's library (provenance)
  library_oid?: string
  display_style?: 'flowchart' | 'bpmn' | 'isa88'
  steps: MasterWorkflowStep[]
  connections: WorkflowConnection[]
  resource_property_specifications?: ResourcePropertySpecification[]
  starting_parameter_specifications?: ParameterSpecification[]
  try_specifications?: TrySpecification[]
  output_parameter_specifications?: OutputParameterSpecification[]
  value_property_specifications?: PropertySpecification[]
  viewport?: { x: number; y: number; zoom: number }
  environment_specifications?: MasterEnvironmentSpecification[] // root only; action bodies inlined
  children?: ChildWorkflowExport[] // recursive; parentChildSpecId null = direct child of the root
}
```

The authoritative TypeScript types are in `src/lib/packageFormat/export-types.ts`.

Rules that matter for packaging:

1. **Embedded child workflows** — every `workflowProxy` that references a step library is resolved to an embedded child with fresh oids before export (`inlineReferencedSteps.ts`), so the package never points outside itself. Children carry the root's `version` and `state`. On import, each `WORKFLOW PROXY` step is linked back to the child whose `local_id` equals the step's `local_id`.
2. **Forms** — a form-bearing step carries its Form Document v2 verbatim in `form_document` (ids kept). On import every `form_document` is validated against `src/lib/schemas/form-document.json`; a legacy `form_layout_config` (≤ 4.0) is converted to a `form_document`.
3. **Environment links** — each embedded environment carries `library_name`. On import the workflow is linked to the environment library whose `environments/<name>.WFenvir` filename equals that `library_name`.

### `manifest.json`

```json
{
  "packageVersion": "1.0",
  "workflowName": "My Workflow",
  "environmentLibraries": ["Kitchen Library"],
  "actionLibraries": ["Oven Controls"],
  "createdAt": "2026-04-24T12:00:00.000Z",
  "files": [
    { "path": "My_Workflow.WFmaster", "type": "workflow" },
    { "path": "environments/Kitchen Library.WFenvir", "type": "environment" },
    { "path": "actions/Oven Controls.WFaction", "type": "action" },
    { "path": "images/7000000123456-photo.jpg", "type": "image" }
  ]
}
```

The manifest is **export-only metadata**: `safeZipReader.ts` reads it but nothing downstream uses it.

## Export flow

Source: `src/server/routes/v2/packages.ts`, `src/server/packageFormat/buildWorkflowPackage.ts`.

1. `specReadDao.getSpec` — the id must be a root spec (otherwise `404 not_found`).
2. `specReadDao.getTree(ctx, rootSpecId)` — permission-checked fetch of the tree (`413 tree_too_large` past the tree limits).
3. `buildWorkflowPackage` —
   - `adaptSpecTree` + `inlineReferencedSteps` — client-shaped specs with every referenced step library embedded.
   - Loads the action libraries the environments name (the environment's team wins a name clash with GLOBAL), so the environment exporter can inline action bodies.
   - `exportWorkflowSpec` — the envelope JSON, including `action_proxy_config` derived by name and Action-Property bindings.
   - `exportEnvironmentLibrary` / `exportActionLibrary` — the `environments/` and `actions/` entries.
   - Image bytes from `image` + `image_blob` and from `spec.data.images` data URIs.
4. ZIP assembly: `<safeName>.WFmaster` (pretty-printed, 2-space indent), `environments/*`, `actions/*`, `images/*`, `manifest.json`.
5. Response: `Content-Type: application/zip`, `Content-Disposition: attachment; filename="<safeName>.WFmasterX"`, `Cache-Control: private, no-store`. Anything the export could not carry (an undecodable image, an ambiguous Action-Property binding) is listed in an `x-export-warnings` header: a JSON array of strings, percent-encoded.

## Import flow

Source: `src/server/routes/v2/packages.ts`, `packageFormat/safeZipReader.ts`, `parseEnvelope.ts`, `importLibrariesFromZip.ts`, `injectWorkflowEnvSpecIds.ts`, `buildImportBatch.ts`, `injectEmbeddedWorkflowSpecIds.ts`, `insertImportImages.ts`.

Request — `multipart/form-data`:

| Field           | Type          | Required |
| --------------- | ------------- | -------- |
| file            | binary (ZIP)  | yes      |
| targetLibraryId | string (UUID) | yes      |

Pipeline:

1. **Size check** — a request over `MAX_IMPORT_REQUEST_BYTES` is refused before its body is read; a file over `MAX_IMPORT_ZIP_BYTES` is refused before it is buffered (`413 zip_too_large`).
2. **`readSafeZip(buffer)`** — entry-count, filename and size validation, byte-budgeted inflation, MIME sniff on every `images/*` entry; collects the envelope, `environments/*.WFenvir`, `actions/*.WFaction` and images.
3. **`parseWorkflowEnvelope(jsonText)`** — requires `schemaVersion` from `4.0` to `5.0`, a root `oid` and `local_id`; converts the root and every `children[]` entry to the editor's internal shape (`importWorkflowSpecToInternal`), and:
   - extracts `embeddedWorkflowSpecId` values into a separate `proxyRefs` list,
   - collects image filenames from `form_document` image blocks (and legacy layouts) into `imageRefs`,
   - collects each embedded environment's `library_name` as a pending environment-library link,
   - drops the deprecated `child_workflows[]` (a warning is logged when it is the only child source).
4. **Missing images** — image references with no bytes in the ZIP are dropped and their `src` cleared, rather than failing the import; surviving bytes are mirrored into `spec.data.images` as data URIs.
5. **One transaction** for everything below; any failure rolls all of it back:
   1. `importLibrariesFromZip` — each `environments/` and `actions/` library is matched by name (the filename stem) in the target library's team, then in GLOBAL, and reused as it is; only a miss creates a new library in the target team. An unparseable or invalid sibling is skipped with a warning.
   2. `injectWorkflowEnvSpecIds` — points each workflow's `data.environmentSpecIds` at the matched or created environment specs.
   3. Pending environment-library links resolve by name to library ids; a name with no `environments/` file is dropped with a warning.
   4. `buildImportBatch` — fresh UUIDs for every spec, parent/root/proxy relationships re-wired via a `sourceId → newId` map. A root whose name and version already exist in the target library is renamed `<name> (2)`, `<name> (3)`, …; children are deduplicated the same way under their parent.
   5. `injectEmbeddedWorkflowSpecIds` — restores `node.data.embeddedWorkflowSpecId` on each `workflowProxy` node.
   6. Environment links to libraries the importing user cannot see are dropped.
   7. **Batch save** — creates `specification`, `proxy_reference`, `image_reference` and `specification_environment` rows.
   8. **`insertImportImages`** — for each image, compute SHA-256, upsert `image_blob` (ON CONFLICT DO NOTHING), insert `image`.
6. **Defaults** (`parseEnvelope.ts`): missing `version` → `'1.0.0'`; missing `state` → `'Draft'`; `dataSchemaVersion` is always the current one (`4`); a `type_name` that is not a non-blank string of at most 50 characters is dropped.

### Import response

```json
{
  "rootSpecId": "uuid-of-new-root",
  "specCount": 42,
  "imageCount": 17,
  "envLibrariesCreated": 1,
  "envLibrariesReused": 0,
  "actionLibrariesCreated": 1,
  "actionLibrariesReused": 0,
  "warnings": []
}
```

`warnings` lists everything the import skipped rather than failed on: unimportable sibling libraries, unresolvable environment-library links, libraries linked to GLOBAL.

### Intermediate types

```ts
interface ImportSpec {
  sourceId: string
  parentSourceId: string | null
  rootSourceId: string
  name: string
  description: string | null
  typeName?: string | null
  version: string
  state: string
  dataJson: string // proxy refs stripped, JSON-stringified
  dataSchemaVersion: number
}

interface ImportProxyRef {
  parentSourceId: string
  nodeId: string
  targetSourceId: string
}

interface ImportImageRef {
  specSourceId: string
  filename: string
}

interface ImportSpecEnv {
  specSourceId: string
  environmentLibraryId: string
}

interface ImportPendingEnvLink {
  specSourceId: string
  libraryName: string
}

interface ImportPlan {
  specs: ImportSpec[]
  proxyRefs: ImportProxyRef[]
  imageRefs: ImportImageRef[]
  specEnvs: ImportSpecEnv[]
  pendingEnvLibraryLinks: ImportPendingEnvLink[]
}
```

## Limits (`src/server/limits.ts`)

| Limit                        | Value                                    |
| ---------------------------- | ---------------------------------------- |
| `MAX_IMPORT_REQUEST_BYTES`   | 61 MB (whole upload request)             |
| `MAX_IMPORT_ZIP_BYTES`       | 60 MB (the uploaded file)                |
| `MAX_IMPORT_PER_ENTRY_BYTES` | 10 MB (per decompressed non-image entry) |
| `MAX_IMAGE_BYTES`            | 5 MB (per decompressed `images/*` entry) |
| `MAX_IMPORT_TOTAL_BYTES`     | 100 MB (total decompressed)              |
| `MAX_IMPORT_ENTRIES`         | 1100                                     |
| `MAX_IMAGES_PER_IMPORT`      | 500                                      |
| `MAX_TREE_SPECS`             | 5000                                     |
| `MAX_TREE_PROXY_REFS`        | 10000                                    |
| `MAX_TREE_IMAGES`            | 2000                                     |

## ZIP safety rules

Applied per entry in `safeZipReader.ts`:

- Filename non-empty, ≤ 255 chars, matches `/^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,254}$/`.
- No leading `/`, no `..`, no NUL bytes.
- Each entry is inflated under its byte budget (`MAX_IMAGE_BYTES` for `images/*`, `MAX_IMPORT_PER_ENTRY_BYTES` otherwise) and the running total under `MAX_IMPORT_TOTAL_BYTES`; inflation stops as soon as a budget is passed.
- Every `images/*` entry is MIME-sniffed (PNG / JPEG / WebP / GIF only) and its name (after `images/`) must match `/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,254}$/`.
- Entry kind is restricted to `*.WFmaster`, `manifest.json`, `environments/*.WFenvir`, `actions/*.WFaction` and `images/*`; any other path fails with `zip_filename_invalid { reason: 'unknown entry type' }`.
- Multiple `.WFmaster` entries: only the first is parsed; later ones still count toward the byte limits.

## Image MIME magic bytes (`src/server/imageMime.ts`)

| Format | Signature                                    |
| ------ | -------------------------------------------- |
| PNG    | `89 50 4E 47 0D 0A 1A 0A`                    |
| JPEG   | `FF D8 FF`                                   |
| GIF    | `GIF87a` / `GIF89a`                          |
| WebP   | `RIFF....WEBP` (RIFF at 0–3, `WEBP` at 8–11) |

## Error codes

From `safeZipReader.ts` / `parseEnvelope.ts` / `routes/v2/packages.ts`. Size and count codes return 413; other ZIP and envelope codes return 422.

| Code                         | Source                              | Meaning                                                                                                                                                                      |
| ---------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `json_envelope_invalid`      | safeZipReader.ts / parseEnvelope.ts | Not a valid ZIP, corrupt entry, no `.WFmaster` entry, envelope not parseable JSON or not an object, missing or non-numeric `schemaVersion`, root missing `oid` or `local_id` |
| `unsupported_schema_version` | parseEnvelope.ts                    | `parseFloat(schemaVersion)` below `4.0` or above `5.0` (note `parseFloat` tolerates `"5.0-beta"`)                                                                            |
| `invalid_form_document`      | parseEnvelope.ts                    | A step's `form_document` fails the Form Document v2 schema                                                                                                                   |
| `zip_too_many_entries`       | safeZipReader.ts                    | Entry count exceeds `MAX_IMPORT_ENTRIES`                                                                                                                                     |
| `zip_filename_invalid`       | safeZipReader.ts                    | Filename fails validation (charset, length, absolute, traversal, nul, image filename charset, or unknown entry type)                                                         |
| `zip_entry_too_large`        | safeZipReader.ts                    | Single entry exceeds its cap                                                                                                                                                 |
| `zip_total_too_large`        | safeZipReader.ts                    | Total decompressed exceeds cap                                                                                                                                               |
| `zip_too_large`              | packages.ts                         | Upload exceeds `MAX_IMPORT_ZIP_BYTES` / `MAX_IMPORT_REQUEST_BYTES`                                                                                                           |
| `zip_image_mime_invalid`     | safeZipReader.ts                    | Image MIME sniff failed or disallowed                                                                                                                                        |
| `too_many_images`            | safeZipReader.ts                    | Image count exceeds `MAX_IMAGES_PER_IMPORT`                                                                                                                                  |
| `image_not_found`            | packages.ts                         | An image row to insert has no bytes in the ZIP (`insertImportImages`)                                                                                                        |
| `schema_mismatch`            | packages.ts                         | Multipart body unreadable, or `file` / `targetLibraryId` missing                                                                                                             |
| `not_found`                  | packages.ts                         | Target library not visible (import); spec missing or not a root (export)                                                                                                     |
| `tree_too_large`             | packages.ts                         | Export tree exceeds a `MAX_TREE_*` limit (413)                                                                                                                               |

Errors from the batch save (for example `schema_mismatch` or `parent_not_found`) are returned with the batch save's own status and body, and roll the whole import back.

## Round-trip invariants

- **Schema gate:** import requires `4.0 ≤ schemaVersion ≤ 5.0`; export writes `5.0`.
- **Proxy inlining ↔ extraction:** references to step libraries are embedded on export; on import each `WORKFLOW PROXY` is re-linked to its child by `local_id` and the link is stored as a `proxy_reference` row.
- **Image namespacing:** form images are written as `images/{imageOid}-{filename}` and UI-parameter images as `images/{filename}`; import resolves bare, `{specId}-` prefixed and `-{filename}` suffixed entries.
- **Fresh IDs:** import mints new UUIDs for every spec and re-wires parent / root / proxy references via a `sourceId → newId` map — the import is additive and never overwrites existing specs.
- **Libraries by name:** environment and action libraries are reused by name (team first, then GLOBAL) and created only when missing.
- **Blob dedup:** multiple logical images with identical bytes share one `image_blob` row via SHA-256 `contentHash`.

## Key source files

- `src/server/routes/v2/packages.ts` — REST endpoints.
- `src/server/packageFormat/buildWorkflowPackage.ts` — `.WFmasterX` builder.
- `src/lib/packageFormat/workflow-exporters.ts`, `library-exporters.ts`, `export-types.ts` — envelope and library JSON.
- `src/server/packageFormat/parseEnvelope.ts` — envelope parser.
- `src/server/packageFormat/safeZipReader.ts` — ZIP validation.
- `src/server/packageFormat/importLibrariesFromZip.ts` — environment / action library reuse and creation.
- `src/server/packageFormat/buildImportBatch.ts` — `ImportPlan` → `BatchSaveRequest`.
- `src/server/packageFormat/insertImportImages.ts` — image blob upsert.
- `src/server/packageFormat/loadImageBytes.ts` — export-side image loader.
- `src/server/batchSave/requestSchema.ts` — Zod schema for batch save.
- `src/server/imageMime.ts` — MIME sniffing and filename regex.
- `src/server/limits.ts` — hard limits.
- `src/server/dao/specReadDao.ts` — `SpecTree` read model consumed by export.
