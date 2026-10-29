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

// Seeds a library into the e2e database through the real .WFlibX API (preview, then commit with
// every conflict kept), signed in as the admin whose cookies the passed request context carries.

import type { APIRequestContext } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/** API server the E2E harness boots on. */
const API_BASE = 'http://localhost:3001'
/** Origin the dev origin/CORS layer trusts — Vite's dev port. */
const ORIGIN = 'http://localhost:5174'

interface PreviewResponse {
  previewId: string
  rows: Array<{ bundleOid: string; status: { tag: string } }>
}

export async function seedFromWflibx(request: APIRequestContext, file: string, teamId: string): Promise<void> {
  const preview = await request.post(`${API_BASE}/api/v2/packages/workflow-library/preview`, {
    headers: { Origin: ORIGIN },
    multipart: { file: { name: path.basename(file), mimeType: 'application/zip', buffer: readFileSync(file) } },
  })
  if (!preview.ok()) throw new Error(`seed preview failed: ${preview.status()} ${await preview.text()}`)
  const plan = (await preview.json()) as PreviewResponse

  const resolutions: Record<string, 'keep'> = {}
  for (const row of plan.rows) if (row.status.tag === 'conflict') resolutions[row.bundleOid] = 'keep'

  const commit = await request.post(`${API_BASE}/api/v2/packages/workflow-library/commit`, {
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    data: { previewId: plan.previewId, resolutions, teamId },
  })
  if (!commit.ok()) throw new Error(`seed commit failed: ${commit.status()} ${await commit.text()}`)
}
