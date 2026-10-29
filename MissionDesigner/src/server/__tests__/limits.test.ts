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

// @vitest-environment node

import { describe, it, expect } from 'vitest'
import {
  MAX_SPECS_PER_BATCH,
  MAX_BATCH_BYTES,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_UPLOAD_MULTIPART_BYTES,
  MAX_BULK_FETCH_IDS,
  MAX_TREE_SPECS,
  MAX_TREE_PROXY_REFS,
  MAX_TREE_IMAGES,
  MAX_LIBRARIES_PER_LIST,
  RATE_LIMIT_MUTATING_PER_MIN,
  RATE_LIMIT_READS_PER_MIN,
  MAX_IMAGE_REF_BULK_ITEMS,
} from '../limits'
import {
  MAX_IMPORT_ZIP_BYTES,
  MAX_IMPORT_PER_ENTRY_BYTES,
  MAX_IMPORT_TOTAL_BYTES,
  MAX_IMAGES_PER_IMPORT,
  MAX_IMPORT_ENTRIES,
  MAX_BACKUP_ENTRIES,
  MAX_BACKUP_INFLATED_BYTES,
  MAX_BACKUP_JSON_BYTES,
} from '../limits'

describe('limits: §2.13 hard limits are pinned', () => {
  it('MAX_SPECS_PER_BATCH = 500', () => expect(MAX_SPECS_PER_BATCH).toBe(500))
  it('MAX_BATCH_BYTES = 52_428_800 (50 MB)', () => expect(MAX_BATCH_BYTES).toBe(50 * 1024 * 1024))
  it('MAX_IMAGE_BYTES = 5_242_880 (5 MB)', () => expect(MAX_IMAGE_BYTES).toBe(5 * 1024 * 1024))
  it('MAX_IMAGE_UPLOAD_MULTIPART_BYTES = 6_291_456 (6 MB)', () =>
    expect(MAX_IMAGE_UPLOAD_MULTIPART_BYTES).toBe(6 * 1024 * 1024))
  it('MAX_BULK_FETCH_IDS = 100', () => expect(MAX_BULK_FETCH_IDS).toBe(100))
  it('MAX_TREE_SPECS = 5000', () => expect(MAX_TREE_SPECS).toBe(5000))
  it('MAX_TREE_PROXY_REFS = 10000', () => expect(MAX_TREE_PROXY_REFS).toBe(10000))
  it('MAX_TREE_IMAGES = 2000', () => expect(MAX_TREE_IMAGES).toBe(2000))
  it('MAX_LIBRARIES_PER_LIST = 1000', () => expect(MAX_LIBRARIES_PER_LIST).toBe(1000))
  it('RATE_LIMIT_MUTATING_PER_MIN = 120', () => expect(RATE_LIMIT_MUTATING_PER_MIN).toBe(120))
  it('RATE_LIMIT_READS_PER_MIN = 6000', () => expect(RATE_LIMIT_READS_PER_MIN).toBe(6000))
  it('MAX_IMAGE_REF_BULK_ITEMS = 50', () => expect(MAX_IMAGE_REF_BULK_ITEMS).toBe(50))
})

describe('limits: §2.13 import limits are pinned (Plan 2b)', () => {
  it('MAX_IMPORT_ZIP_BYTES = 62_914_560 (60 MB)', () => expect(MAX_IMPORT_ZIP_BYTES).toBe(60 * 1024 * 1024))
  it('MAX_IMPORT_PER_ENTRY_BYTES = 10_485_760 (10 MB)', () => expect(MAX_IMPORT_PER_ENTRY_BYTES).toBe(10 * 1024 * 1024))
  it('MAX_IMPORT_TOTAL_BYTES = 104_857_600 (100 MB)', () => expect(MAX_IMPORT_TOTAL_BYTES).toBe(100 * 1024 * 1024))
  it('MAX_IMAGES_PER_IMPORT = 500', () => expect(MAX_IMAGES_PER_IMPORT).toBe(500))
  it('MAX_IMPORT_ENTRIES = 1100', () => expect(MAX_IMPORT_ENTRIES).toBe(1100))
})

describe('limits: backup restore limits are pinned (data-safety)', () => {
  it('MAX_BACKUP_ENTRIES = 20_000', () => expect(MAX_BACKUP_ENTRIES).toBe(20_000))
  it('MAX_BACKUP_INFLATED_BYTES = 524_288_000 (500 MB)', () =>
    expect(MAX_BACKUP_INFLATED_BYTES).toBe(500 * 1024 * 1024))
  it('MAX_BACKUP_JSON_BYTES = 419_430_400 (400 MB)', () => expect(MAX_BACKUP_JSON_BYTES).toBe(400 * 1024 * 1024))
})
