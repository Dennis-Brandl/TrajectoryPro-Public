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

// Phase 35 §2.13: hard limits — pinned so every endpoint references the same
// numbers. Edit here, edit the tests in src/server/__tests__/limits.test.ts,
// edit the spec §2.13 table, all three in one commit.

export const MAX_SPECS_PER_BATCH = 500
export const MAX_BATCH_BYTES = 50 * 1024 * 1024 // 52_428_800
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024 // 5_242_880
export const MAX_IMAGE_UPLOAD_MULTIPART_BYTES = 6 * 1024 * 1024 // 6_291_456 (MAX_IMAGE_BYTES + 1 MB envelope headroom)
export const MAX_BULK_FETCH_IDS = 100
export const MAX_TREE_SPECS = 5000
export const MAX_TREE_PROXY_REFS = 10000
export const MAX_TREE_IMAGES = 2000
export const MAX_LIBRARIES_PER_LIST = 1000
export const RATE_LIMIT_MUTATING_PER_MIN = 120
// Reads are sized for real projects: dozens of libraries with dozens of
// workflows each. Opening a workflow costs one list + one bulk-fetch per
// environment/action library, expanding the sidebar one list + one tree per
// library — a few hundred reads in a busy minute with ~50 libraries. 6,000
// leaves >10× headroom for that while still stopping a runaway client loop,
// which produces thousands of requests per SECOND. (Was 600, and a general
// 100/min cap sat on top of it, which 8 libraries were enough to trip.)
export const RATE_LIMIT_READS_PER_MIN = 6000
export const MAX_IMAGE_REF_BULK_ITEMS = 50

// Phase 35 §2.13 (Plan 2b additions): import endpoint hard limits.
export const MAX_IMPORT_ZIP_BYTES = 60 * 1024 * 1024 // 62_914_560 (raw multipart cap; matches MAX_BATCH_BYTES + headroom)
export const MAX_IMPORT_REQUEST_BYTES = MAX_IMPORT_ZIP_BYTES + 1024 * 1024 // whole upload request: the zip plus 1 MB of multipart overhead
export const MAX_IMPORT_PER_ENTRY_BYTES = 10 * 1024 * 1024 // 10_485_760 (zip-bomb defense per entry)
export const MAX_IMPORT_TOTAL_BYTES = 100 * 1024 * 1024 // 104_857_600 (zip-bomb defense total decompressed)
export const MAX_IMAGES_PER_IMPORT = 500
export const MAX_IMPORT_ENTRIES = 1100 // 500 specs (encoded as JSON inside one entry) + 500 images + slack

// Backup restore limits (data-safety spec 2026-10-21). Larger than the package-import caps so any
// backup this Designer exports can be restored; GET /api/backup refuses content beyond them.
// Largest backup file the inspect and restore routes accept. The export refuses to hand out a file past this.
export const MAX_BACKUP_UPLOAD_BYTES = 100 * 1024 * 1024 // 104_857_600
export const MAX_BACKUP_ENTRIES = 20_000
export const MAX_BACKUP_INFLATED_BYTES = 500 * 1024 * 1024 // 524_288_000 (total decompressed)
export const MAX_BACKUP_JSON_BYTES = 400 * 1024 * 1024 // 419_430_400 (backup.json alone); blobs/* use MAX_IMAGE_BYTES
