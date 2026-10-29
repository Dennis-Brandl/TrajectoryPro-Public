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
import { translatePostgresError, translateSqliteError } from '../errorTranslate'

describe('translatePostgresError (§2.4 SQLSTATE-keyed)', () => {
  it('23505 unique_violation → 409 conflict unique with constraint name', () => {
    const r = translatePostgresError({ code: '23505', constraint: 'library_name_unique' })
    expect(r).toEqual({
      status: 409,
      body: { code: 'conflict', conflictType: 'unique', constraint: 'library_name_unique' },
    })
  })

  it('23505 unique_violation with no constraint → 409 conflict with unknown', () => {
    const r = translatePostgresError({ code: '23505' })
    expect(r.status).toBe(409)
    expect(r.body).toEqual({ code: 'conflict', conflictType: 'unique', constraint: 'unknown' })
  })

  it('23503 fk_violation on imageId (via detail) → 422 image_not_found', () => {
    const r = translatePostgresError({
      code: '23503',
      constraint: 'image_reference_imageId_fkey',
      detail: 'Key (imageId)=(abc) is not present in table "image".',
    })
    expect(r).toEqual({ status: 422, body: { code: 'image_not_found', table: 'image_reference' } })
  })

  it('23503 fk_violation on imageId (via constraint name) → 422 image_not_found', () => {
    const r = translatePostgresError({ code: '23503', constraint: 'image_reference_imageId_fkey' })
    expect(r).toEqual({ status: 422, body: { code: 'image_not_found', table: 'image_reference' } })
  })

  it('23503 fk_violation on image_reference + specificationId → 422 parent_not_found for image_reference', () => {
    // Combined constraint+detail string must match /image_reference.*specificationId/i
    const r = translatePostgresError({
      code: '23503',
      constraint: 'image_reference_specificationId_fkey',
      detail: 'Key (specificationId)=(s1) is not present in table "specification".',
    })
    expect(r).toEqual({ status: 422, body: { code: 'parent_not_found', table: 'image_reference' } })
  })

  it('23503 fk_violation on targetSpecificationId → 409 conflict restrict', () => {
    const r = translatePostgresError({
      code: '23503',
      constraint: 'proxy_reference_targetSpecificationId_fkey',
      detail: 'Key (targetSpecificationId)=(s2) is not present in table "specification".',
    })
    expect(r).toEqual({
      status: 409,
      body: {
        code: 'conflict',
        conflictType: 'restrict',
        table: 'proxy_reference',
        constraint: 'targetSpecificationId',
      },
    })
  })

  it('23503 fk_violation with no recognized pattern → 422 parent_not_found', () => {
    const r = translatePostgresError({ code: '23503', constraint: 'some_other_fkey', detail: 'some field value' })
    expect(r).toEqual({ status: 422, body: { code: 'parent_not_found' } })
  })

  it('23514 check_violation → 422 schema_mismatch', () => {
    const r = translatePostgresError({ code: '23514', constraint: 'some_check' })
    expect(r).toEqual({ status: 422, body: { code: 'schema_mismatch' } })
  })

  it('P0001 with known trigger RAISE EXCEPTION message → 422 mapped code', () => {
    const r = translatePostgresError({ code: 'P0001', message: 'proxy reference crosses trees' })
    expect(r).toEqual({ status: 422, body: { code: 'cross_tree_proxy' } })
  })

  it('P0001 with another known trigger message → 422 parent_not_found', () => {
    const r = translatePostgresError({ code: 'P0001', message: 'parent library does not exist' })
    expect(r).toEqual({ status: 422, body: { code: 'parent_not_found' } })
  })

  it('P0001 with unknown trigger message → 422 schema_mismatch (fallback)', () => {
    const r = translatePostgresError({ code: 'P0001', message: 'some unknown trigger RAISE text' })
    expect(r).toEqual({ status: 422, body: { code: 'schema_mismatch' } })
  })

  it('unknown SQLSTATE → 500 internal (scrubbed)', () => {
    const r = translatePostgresError({ code: '08006', message: 'connection failure' })
    expect(r.status).toBe(500)
    expect(r.body).toEqual({ code: 'internal' })
  })

  it('translateSqliteError is kept as an alias for translatePostgresError', () => {
    // Alias is exported so Task-2.9 route callers continue to compile unchanged.
    expect(translateSqliteError).toBe(translatePostgresError)
  })
})
