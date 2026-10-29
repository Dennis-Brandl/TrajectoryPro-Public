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

// Phase 35 §2.4 (Postgres): translate any Postgres error object into the §2.4
// error table's HTTP status + body. NEVER returns raw driver text to callers.
// Maps SQLSTATE codes 23505 / 23503 / 23514 / P0001 (trigger RAISEs).

import { v2ErrorBody } from '../errors/v2'
import { mapTriggerMessageToCode } from './triggerCodeMap'

export interface PgLikeError {
  code?: string
  message?: string
  constraint?: string
  detail?: string
  table?: string
}

// Legacy alias — kept so Task-2.9 callers (routes/v2/specifications.ts) compile
// without changes until that task lands.
export type SqliteLikeError = PgLikeError

export interface TranslatedError {
  status: number
  body: Record<string, unknown>
}

export function translatePostgresError(err: PgLikeError): TranslatedError {
  const code = err.code ?? ''

  // 23505 unique_violation
  if (code === '23505') {
    return {
      status: 409,
      body: { code: 'conflict', conflictType: 'unique', constraint: err.constraint ?? 'unknown' },
    }
  }

  // 23503 fk_violation — inspect constraint + detail to pick the right sub-error
  if (code === '23503') {
    const d = `${err.constraint ?? ''} ${err.detail ?? ''}`
    if (/imageId/i.test(d)) return { status: 422, body: { code: 'image_not_found', table: 'image_reference' } }
    if (/image_reference.*specificationId/i.test(d))
      return { status: 422, body: { code: 'parent_not_found', table: 'image_reference' } }
    if (/targetSpecificationId/i.test(d))
      return {
        status: 409,
        body: {
          code: 'conflict',
          conflictType: 'restrict',
          table: 'proxy_reference',
          constraint: 'targetSpecificationId',
        },
      }
    return { status: 422, body: { code: 'parent_not_found' } }
  }

  // 23514 check_violation
  if (code === '23514') return { status: 422, body: { code: 'schema_mismatch' } }

  // P0001 RAISE EXCEPTION from a PL/pgSQL trigger — message IS the raw RAISE string
  if (code === 'P0001') {
    const mapped = mapTriggerMessageToCode((err.message ?? '').trim())
    if (mapped) return { status: 422, body: v2ErrorBody(mapped) }
    return { status: 422, body: { code: 'schema_mismatch' } }
  }

  return { status: 500, body: { code: 'internal' } }
}

// Alias kept for route callers that still reference the old SQLite name
// (routes/v2/specifications.ts — converted in Task 2.9).
export const translateSqliteError = translatePostgresError
