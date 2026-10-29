# Workflow Package Format (ZIP + JSON)

Reference for the Mission Designer export/import format — the `.WFmasterX` download and `.WFmaster` / `.json` import.

## Overview

- **Container:** ZIP.
- **Envelope schema version:** `'3.0'` (file format; distinct from `dataSchemaVersion`, the per-spec payload version).
- **Download extension:** `.WFmasterX` (ZIP).
- **Envelope entry extension:** `.WFmaster` (server export) or `.json` (client export) — the parser accepts either.
- **Endpoints:**
  - Export: `GET /api/v2/packages/workflow/:rootSpecId`
  - Import: `POST /api/v2/packages/import` (multipart/form-data)

## ZIP Layout

```
workflow.WFmasterX
├── <safeName>.WFmaster         # JSON envelope (first *.json | *.WFmaster entry wins)
└── images/
    ├── <specId>-<filename>     # server export (namespaced by spec)
    └── <filename>              # client export (bare)
```

Notes:

- Only the **first** entry ending in `.json` or `.WFmaster` is parsed as the envelope.
- Image entries can appear with either the `{specId}-{filename}` prefix (server) or bare (client); the importer tries both when resolving references.
- Image MIME is verified by magic-byte sniff (`src/server/imageMime.ts`), not by filename extension.

## Envelope JSON

Top-level:

```ts
interface WorkflowEnvelope {
  schemaVersion: '3.0'
  library: Library
  specifications: EnvelopeSpec[]
  specEnvs: Array<{ specificationId: string; environmentLibraryId: string }>
  imageManifest: Record<string /* specId */, ImageManifestEntry[]>
}
```

### `library`

Metadata about the library the specs belong to.

| Field               | Type           | Notes                                                     |
| ------------------- | -------------- | --------------------------------------------------------- |
| id                  | string         | UUID                                                      |
| userId              | string         | owner UUID                                                |
| parentLibraryId     | string \| null | nested action libraries                                   |
| name                | string         |                                                           |
| entityType          | string         | `workflow` \| `step` \| `environment` \| `action`         |
| description         | string \| null |                                                           |
| author              | string \| null | single line                                               |
| changeHistory       | string \| null | free-form or JSON array                                   |
| version             | string         | default `'1.0.0'`                                         |
| isShared            | number         | `1` or `0` after normalization (`specReadDao.ts:402-408`) |
| forkedFromLibraryId | string \| null |                                                           |
| forkedFromVersion   | string \| null |                                                           |
| forkedAt            | number \| null | epoch ms                                                  |
| createdAt           | number         | epoch ms                                                  |
| updatedAt           | number         | epoch ms                                                  |
| lastEditedByUserId  | string \| null |                                                           |

Note: the `Library` interface at `src/server/dao/specReadDao.ts:40-57` does **not** include `environmentLibraryIds`. The per-library env-library set is stored in the `library_environment` junction table and is not inlined into the envelope's library block. (The `specification` table has its own `environmentLibraryIds` JSON column — different thing.)

### `specifications[]` — `EnvelopeSpec`

One entry per spec in the tree (root + descendants).

| Field                 | Type           | Notes                                                                                        |
| --------------------- | -------------- | -------------------------------------------------------------------------------------------- |
| id                    | string         | UUID                                                                                         |
| libraryId             | string \| null |                                                                                              |
| name                  | string         |                                                                                              |
| description           | string \| null |                                                                                              |
| version               | string \| null |                                                                                              |
| state                 | string \| null | `Draft` \| `InTest` \| `InReview` \| `Approved` \| `Effective` \| `Superseded` \| `Obsolete` |
| data                  | object         | parsed JSON workflow graph — see below                                                       |
| dataSchemaVersion     | number         | currently `3`                                                                                |
| parentSpecificationId | string \| null | null for the root                                                                            |
| rootSpecificationId   | string         | self-reference on the root                                                                   |
| createdAt             | number         | epoch ms                                                                                     |
| updatedAt             | number         | epoch ms                                                                                     |
| children              | string[]       | immediate child spec IDs                                                                     |

#### `data` payload

The workflow graph. Node/edge structure is owned by the client (`nodes`, `edges`, form layouts, etc.). Two rules matter for packaging:

1. **Embedded workflow proxies** — the export inlines each `proxy_reference` row as `node.embeddedWorkflowSpecId` on the corresponding node. The import extracts these back out into a separate `proxyRefs` list before persisting `data`.
2. **Image filenames in form elements** — the `STEP_OID_PREFIX_RE` (`/^[A-Z0-9]+-/`) is stripped from form-element image filenames during import so they match plain `images/<filename>` entries.

### `imageManifest`

Lookup keyed by spec id:

```ts
interface ImageManifestEntry {
  filename: string
  mimeType: string // image/png | image/jpeg | image/webp | image/gif
  byteSize: number
}
```

The manifest is **export-only metadata**. The importer does not read it — `src/server/packageFormat/parseEnvelope.ts` contains zero references to `imageManifest`. Image ingestion is driven entirely by the `images/` ZIP entries plus the `image` filenames found inside `spec.data` form elements; a manifest that disagrees with the ZIP contents is silently ignored.

## Export flow

Source: `src/server/routes/v2/packages.ts`, `src/server/packageFormat/buildEnvelope.ts`, `loadImageBytes.ts`.

1. `specReadDao.getTree(ctx, rootSpecId)` — permission-checked fetch of `{ library, specs, proxyRefs, specEnvs, imageManifest }`.
2. `buildWorkflowEnvelope(tree)` — assembles the v3.0 envelope and inlines `proxy_reference` rows as `node.embeddedWorkflowSpecId`.
3. `loadImageBytesForSpecs(specIds)` — joins `image` + `image_blob` into `Map<specId, LoadedImage[]>`.
4. ZIP assembly:
   - `<safeName>.WFmaster` — envelope JSON (pretty-printed, 2-space indent).
   - `images/<specId>-<filename>` — raw bytes.
5. Response: `Content-Type: application/zip`, `Content-Disposition: attachment; filename="…​.WFmasterX"`.

## Import flow

Source: `src/server/routes/v2/packages.ts`, `packageFormat/safeZipReader.ts`, `parseEnvelope.ts`, `buildImportBatch.ts`, `insertImportImages.ts`.

Request — `multipart/form-data`:

| Field           | Type          | Required |
| --------------- | ------------- | -------- |
| file            | binary (ZIP)  | yes      |
| targetLibraryId | string (UUID) | yes      |

Pipeline:

1. **`readSafeZip(buffer)`** — central-directory parse, entry / filename / size validation, MIME sniff on every `images/*` entry.
2. **`parseEnvelope(jsonText)`** — validate `schemaVersion >= 3.0`, shape-check, and:
   - extract `node.embeddedWorkflowSpecId` values into a separate `proxyRefs` list,
   - collect form-element `image` filenames into an `imageRefs` list,
   - strip the step-OID prefix from image filenames,
   - read the envelope-root `specEnvs[]` (optional on older envelopes; treated as empty when absent).
3. **`buildImportBatch(plan, targetLibraryId)`** — convert the `ImportPlan` into a `BatchSaveRequest` (see `src/server/batchSave/requestSchema.ts`). Fresh UUIDs are minted; parent/root and proxy relationships are re-wired via a `sourceId → newId` map. `specEnvs` entries are remapped onto the new root spec id; `environmentLibraryId` passes through verbatim.
4. **Env-library visibility filter** — `packages.ts` drops any `specEnvs` entry whose `environmentLibraryId` is not a visible environment library for the importing user. This matches fork-library's carried-override semantics and avoids tripping the `specenv_*` triggers, which would roll back the whole import.
5. **Batch save** — creates `specification`, `proxy_reference`, `image_reference`, and `specification_environment` rows atomically.
6. **`insertImportImages`** — for each ZIP image, compute SHA-256, upsert `image_blob` (ON CONFLICT DO NOTHING), insert `image`. The `image_insert_bumps_blob_refcount` trigger updates `refCount`.
7. **Missing-data defaults** (`parseEnvelope.ts:141-144`): if an `EnvelopeSpec` is missing `version` it defaults to `'1.0.0'`; missing `state` → `'Draft'`; missing `dataSchemaVersion` → `3`; missing `data` → `{ nodes: [] }`.

### Import response

```json
{
  "rootSpecId": "uuid-of-new-root",
  "specCount": 42,
  "imageCount": 17
}
```

### Intermediate types

```ts
interface ImportSpec {
  sourceId: string
  parentSourceId: string | null
  rootSourceId: string
  name: string
  description: string | null
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

interface ImportPlan {
  specs: ImportSpec[]
  proxyRefs: ImportProxyRef[]
  imageRefs: ImportImageRef[]
  specEnvs: ImportSpecEnv[]
}
```

## Limits (`src/server/limits.ts`)

| Limit                        | Value                          |
| ---------------------------- | ------------------------------ |
| `MAX_IMPORT_ZIP_BYTES`       | 60 MB (raw multipart)          |
| `MAX_IMPORT_PER_ENTRY_BYTES` | 10 MB (per decompressed entry) |
| `MAX_IMPORT_TOTAL_BYTES`     | 100 MB (total decompressed)    |
| `MAX_IMPORT_ENTRIES`         | 1100                           |
| `MAX_IMAGES_PER_IMPORT`      | 500                            |
| `MAX_IMAGE_BYTES`            | 5 MB                           |
| `MAX_TREE_SPECS`             | 5000                           |
| `MAX_TREE_PROXY_REFS`        | 10000                          |
| `MAX_TREE_IMAGES`            | 2000                           |

## ZIP safety rules

Applied per entry in `safeZipReader.ts`:

- Filename non-empty, ≤ 255 chars, matches `/^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,254}$/`.
- No leading `/`, no `..`, no NUL bytes.
- Per-entry decompressed size ≤ `MAX_IMPORT_PER_ENTRY_BYTES`; running total ≤ `MAX_IMPORT_TOTAL_BYTES`.
- Every `images/*` entry is MIME-sniffed (PNG / JPEG / WebP / GIF only).
- Top-level entry kind is restricted: only `*.json` / `*.WFmaster` (envelope) or `images/*` are accepted; any other path fails with `zip_filename_invalid { reason: 'unknown entry type' }` (`safeZipReader.ts:102`).
- Multiple envelope entries: only the first is parsed; subsequent ones are silently ignored but still count toward total-byte limits.

## Image MIME magic bytes (`src/server/imageMime.ts`)

| Format | Signature                                    |
| ------ | -------------------------------------------- |
| PNG    | `89 50 4E 47 0D 0A 1A 0A`                    |
| JPEG   | `FF D8 FF`                                   |
| GIF    | `GIF87a` / `GIF89a`                          |
| WebP   | `RIFF....WEBP` (RIFF at 0–3, `WEBP` at 8–11) |

Image-reference filenames inside `data` must match `/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,254}$/` (no path separators).

## Error codes

From `safeZipReader.ts` / `parseEnvelope.ts` / `routes/v2/packages.ts`:

| Code                         | Source                | Meaning                                                                                       |
| ---------------------------- | --------------------- | --------------------------------------------------------------------------------------------- |
| `json_envelope_invalid`      | parseEnvelope.ts      | Not parseable JSON, not an object, missing `schemaVersion`, or missing `specifications`       |
| `unsupported_schema_version` | parseEnvelope.ts:76   | `parseFloat(schemaVersion) < 3.0` (2.0 is rejected; note `parseFloat` tolerates `"3.0-beta"`) |
| `zip_too_many_entries`       | safeZipReader.ts:78   | Entry count exceeds `MAX_IMPORT_ENTRIES`                                                      |
| `zip_filename_invalid`       | safeZipReader.ts      | Filename fails validation (charset, length, absolute, traversal, nul, or unknown entry type)  |
| `zip_entry_too_large`        | safeZipReader.ts      | Single entry exceeds per-entry cap                                                            |
| `zip_total_too_large`        | safeZipReader.ts      | Total decompressed exceeds cap                                                                |
| `zip_too_large`              | packages.ts:105       | Raw multipart payload exceeds `MAX_IMPORT_ZIP_BYTES`                                          |
| `zip_image_mime_invalid`     | safeZipReader.ts      | Image MIME sniff failed or disallowed                                                         |
| `too_many_images`            | safeZipReader.ts      | Image count exceeds `MAX_IMAGES_PER_IMPORT`                                                   |
| `image_not_found`            | packages.ts:175       | A `spec.data` image filename is not present as an `images/*` ZIP entry                        |
| `schema_mismatch`            | packages.ts:94,98,100 | Envelope shape failed route-level validation (wrong field types / missing required)           |

## Round-trip invariants

- **Schema gate:** parser requires `schemaVersion >= 3.0`; 2.0 envelopes are rejected. Client migration to 3.0 is handled during authoring, not import.
- **Proxy inlining ↔ extraction:** export writes `node.embeddedWorkflowSpecId`; import strips it back into `proxy_reference` rows.
- **Image namespacing:** server exports use `images/<specId>-<filename>`; client exports use bare `images/<filename>`; import resolves both.
- **OID prefix:** `STEP_OID_PREFIX_RE` is stripped from form-element image filenames on import.
- **Fresh IDs:** import mints new UUIDs for every spec and re-wires parent / root / proxy references via a `sourceId → newId` map — the import is additive and never overwrites existing rows.
- **Blob dedup:** multiple logical images with identical bytes share one `image_blob` row via SHA-256 `contentHash`.

## Key source files

- `src/server/routes/v2/packages.ts` — REST endpoints.
- `src/server/packageFormat/buildEnvelope.ts` — envelope builder.
- `src/server/packageFormat/parseEnvelope.ts` — envelope parser.
- `src/server/packageFormat/safeZipReader.ts` — ZIP validation.
- `src/server/packageFormat/buildImportBatch.ts` — `ImportPlan` → `BatchSaveRequest`.
- `src/server/packageFormat/insertImportImages.ts` — image blob upsert.
- `src/server/packageFormat/loadImageBytes.ts` — export-side image loader.
- `src/server/batchSave/requestSchema.ts` — Zod schema for batch save.
- `src/server/imageMime.ts` — MIME sniffing and filename regex.
- `src/server/limits.ts` — hard limits.
- `src/server/dao/specReadDao.ts` — `SpecTree` read model consumed by export.
