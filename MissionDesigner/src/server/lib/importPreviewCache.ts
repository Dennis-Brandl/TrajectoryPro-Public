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

import { randomBytes } from 'node:crypto'

interface CachedEntry<T> {
  value: T
  insertedAt: number
}

interface CacheOptions {
  capacity: number
  ttlMs: number
}

/**
 * Process-local LRU keyed by an opaque previewId, with per-entry TTL.
 * Holds at most `capacity` entries; oldest is evicted on overflow.
 *
 * Used by the workflow-library import flow to keep a parsed bundle
 * between the /preview and /commit calls without re-uploading.
 */
export class ImportPreviewCache<T> {
  private entries = new Map<string, CachedEntry<T>>()
  private readonly capacity: number
  private readonly ttlMs: number

  constructor(opts: CacheOptions) {
    this.capacity = opts.capacity
    this.ttlMs = opts.ttlMs
  }

  put(value: T): string {
    const id = randomBytes(16).toString('hex')
    if (this.entries.size >= this.capacity) {
      const oldest = this.entries.keys().next().value
      if (oldest) this.entries.delete(oldest)
    }
    this.entries.set(id, { value, insertedAt: Date.now() })
    return id
  }

  get(id: string): T | undefined {
    const entry = this.entries.get(id)
    if (!entry) return undefined
    if (Date.now() - entry.insertedAt > this.ttlMs) {
      this.entries.delete(id)
      return undefined
    }
    return entry.value
  }

  evict(id: string): void {
    this.entries.delete(id)
  }
}
