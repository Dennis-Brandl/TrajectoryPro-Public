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

// Phase 35 §2.4: batch-save orchestrator.

import { phase1Validate, Phase1Error } from './phase1Validate'
import { phase2Apply, Phase2Error } from './phase2Apply'
import { BatchSaveRequest } from './requestSchema'
import type { ReadContext } from '../dao/specReadDao'
import type { Principal } from '../authz/policy'

// Re-export so callers that wrap runBatchSave in an outer TX can catch
// Phase1Error / Phase2Error outside the transaction to produce HTTP responses.
export { Phase1Error } from './phase1Validate'
export { Phase2Error } from './phase2Apply'

/** Connection-scoped query function from an outer withTransaction. */
type Q = <R = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<R[]>

/** Optional overrides for the import path where runBatchSave runs inside an
 *  outer withTransaction. When externalQ is provided:
 *  - Phase1Error and Phase2Error propagate (they are NOT caught here) so they
 *    roll back the outer transaction.
 *  - externalPrincipal and externalLocked must have been loaded OUTSIDE the
 *    outer TX (rawQuery deadlocks inside pglite.transaction).
 */
export interface RunBatchSaveOpts {
  externalQ?: Q
  externalPrincipal?: Principal
  externalLocked?: Set<string>
}

export interface BatchSaveOutcome {
  status: number
  body: Record<string, unknown>
}

export async function runBatchSave(
  rawBody: unknown,
  ctx: ReadContext,
  opts?: RunBatchSaveOpts,
): Promise<BatchSaveOutcome> {
  const parsed = BatchSaveRequest.safeParse(rawBody)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    const code = first?.code === 'unrecognized_keys' ? 'unknown_field' : 'schema_mismatch'
    return { status: 422, body: { code, issue: first?.message } }
  }
  const req = parsed.data

  const { externalQ, externalPrincipal, externalLocked } = opts ?? {}

  if (externalQ) {
    // Import path: running inside an outer withTransaction.
    // Phase1Error / Phase2Error propagate to the caller — do NOT catch them
    // here, so the outer TX rolls back on any failure.
    const plan = await phase1Validate(req, ctx, { q: externalQ, principal: externalPrincipal, locked: externalLocked })
    await phase2Apply(req, plan, ctx, externalQ, externalPrincipal, externalLocked)
    const specIds = req.specs.filter((s) => s.op !== 'delete').map((s) => ({ id: s.id }))
    const libraryIds = Array.from(plan.touchedLibraryIds).map((id) => ({ id }))
    return { status: 200, body: { specs: specIds, libraries: libraryIds } }
  }

  // Standalone path (specifications.ts batchSave route): catch Phase1/Phase2
  // errors and return them as HTTP status values, unchanged from before.
  let plan
  try {
    plan = await phase1Validate(req, ctx)
  } catch (err) {
    if (err instanceof Phase1Error) return { status: err.status, body: err.body }
    throw err
  }

  try {
    await phase2Apply(req, plan, ctx)
  } catch (err) {
    if (err instanceof Phase2Error) return { status: err.status, body: err.body }
    throw err
  }

  const specIds = req.specs.filter((s) => s.op !== 'delete').map((s) => ({ id: s.id }))
  const libraryIds = Array.from(plan.touchedLibraryIds).map((id) => ({ id }))
  return {
    status: 200,
    body: { specs: specIds, libraries: libraryIds },
  }
}
