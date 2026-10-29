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

import type { ScanReport } from './types'

const TTL_MS = 15 * 60 * 1000
const store = new Map<string, ScanReport>()

export const reportCache = {
  set(report: ScanReport): void {
    store.set(report.scanId, report)
  },
  get(scanId: string): ScanReport | undefined {
    const r = store.get(scanId)
    if (!r) return undefined
    if (Date.now() - r.createdAt > TTL_MS) {
      store.delete(scanId)
      return undefined
    }
    return r
  },
  delete(scanId: string): void {
    store.delete(scanId)
  },
  clear(): void {
    store.clear()
  },
}
