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

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { BuildResult } from './types.js'

export interface UploadBulkResult {
  envImported: boolean
  codeUploaded: number
  codeFailed: Array<{ actionLocalId: string; state: string; error: string }>
  timeoutsSet: number
}

export interface UploadPerActionResult {
  actionsImported: number
  actionsFailed: Array<{ actionLocalId: string; error: string }>
  timeoutsSet: number
}

/** Auth header for /management/v1 calls; the key comes from ACTIONS_API_KEY. */
function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const key = (process.env.ACTIONS_API_KEY ?? '').trim()
  if (!key) {
    throw new Error(
      'ACTIONS_API_KEY is not set. Export the same key the Autopilot server runs with (see .env).'
    )
  }
  return { ...extra, 'X-API-Key': key }
}

async function postFile(
  serverUrl: string,
  filePath: string,
  filename: string,
  contentType: string
): Promise<Response> {
  const buf = await readFile(filePath)
  const form = new FormData()
  // Node's FormData accepts Blob; build one from the buffer.
  const blob = new Blob([buf], { type: contentType })
  form.append('files', blob, filename)
  return fetch(`${serverUrl}/management/v1/upload`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  })
}

async function setTimeoutForAction(
  serverUrl: string,
  oid: string,
  timeout_seconds: number | null
): Promise<void> {
  const res = await fetch(`${serverUrl}/management/v1/actions/${oid}/timeout`, {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ timeout_seconds }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Failed to set timeout for ${oid}: ${res.status} ${text}`)
  }
}

export async function uploadScenarioBulk(
  build: BuildResult,
  serverUrl: string
): Promise<UploadBulkResult> {
  const result: UploadBulkResult = {
    envImported: false,
    codeUploaded: 0,
    codeFailed: [],
    timeoutsSet: 0,
  }

  // 1. POST .WFenvir
  const envRes = await postFile(
    serverUrl,
    build.envFilePath,
    path.basename(build.envFilePath),
    'application/json'
  )
  if (!envRes.ok) {
    const text = await envRes.text()
    throw new Error(`Env upload failed: ${envRes.status} ${text}`)
  }
  result.envImported = true

  // 2. POST each code file
  for (const cf of build.codeFiles) {
    const source = await readFile(cf.path, 'utf-8')
    const res = await fetch(`${serverUrl}/management/v1/code/${cf.actionOid}/${cf.state}`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ source_code: source, description: 'scenario import' }),
    })
    if (res.ok) {
      result.codeUploaded += 1
    } else {
      const text = await res.text()
      result.codeFailed.push({
        actionLocalId: cf.actionLocalId,
        state: cf.state,
        error: `${res.status} ${text}`,
      })
    }
  }

  // 3. Apply per-action timeouts
  for (const action of build.actions) {
    if (action.timeout_seconds !== undefined) {
      await setTimeoutForAction(serverUrl, action.oid, action.timeout_seconds)
      result.timeoutsSet += 1
    }
  }

  return result
}

export async function uploadScenarioPerAction(
  build: BuildResult,
  serverUrl: string
): Promise<UploadPerActionResult> {
  const result: UploadPerActionResult = {
    actionsImported: 0,
    actionsFailed: [],
    timeoutsSet: 0,
  }

  // First post a minimal env shell so action environment_oid references resolve.
  // We POST the same .WFenvir that build produced — re-importing is idempotent.
  const envRes = await postFile(
    serverUrl,
    build.envFilePath,
    path.basename(build.envFilePath),
    'application/json'
  )
  if (!envRes.ok) {
    const text = await envRes.text()
    throw new Error(`Env upload failed: ${envRes.status} ${text}`)
  }

  // Now post each .WFactionCodeX
  for (const pkg of build.actionPackages) {
    const res = await postFile(serverUrl, pkg.path, path.basename(pkg.path), 'application/zip')
    if (res.ok) {
      result.actionsImported += 1
    } else {
      const text = await res.text()
      result.actionsFailed.push({
        actionLocalId: pkg.actionLocalId,
        error: `${res.status} ${text}`,
      })
    }
  }

  // Apply per-action timeouts
  for (const action of build.actions) {
    if (action.timeout_seconds !== undefined) {
      await setTimeoutForAction(serverUrl, action.oid, action.timeout_seconds)
      result.timeoutsSet += 1
    }
  }

  return result
}

export async function uploadActionPackage(
  filePath: string,
  serverUrl: string
): Promise<{ ok: boolean; status: number; body: string }> {
  const res = await postFile(serverUrl, filePath, path.basename(filePath), 'application/zip')
  const body = await res.text()
  return { ok: res.ok, status: res.status, body }
}
