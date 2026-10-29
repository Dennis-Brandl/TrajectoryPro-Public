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

import { describe, it, expect, beforeAll } from 'vitest'
import type { Principal } from '../../authz/policy'
import type { gateBatchOp as gateBatchOpT } from '../gate'

let gateBatchOp: typeof gateBatchOpT

beforeAll(async () => {
  // Import db to initialise the in-memory PGlite instance (no bootstrap needed;
  // gateBatchOp uses a hardcoded EDIT_LOCKED_STATES_DEFAULT — no DB queries).
  await import('../../lib/db')
  ;({ gateBatchOp } = await import('../gate'))
})

const lib = { teamId: 't1', entityType: 'workflow' }

const author: Principal = {
  userId: 'u1',
  isAdministrator: false,
  memberships: new Set(['t1']),
  rightsByTeam: new Map([['t1', new Set(['workflow:create', 'workflow:edit', 'workflow:delete'])]]),
}
const editOnly: Principal = {
  userId: 'u2',
  isAdministrator: false,
  memberships: new Set(['t1']),
  rightsByTeam: new Map([['t1', new Set(['workflow:edit'])]]),
}
const admin: Principal = {
  userId: 'a',
  isAdministrator: true,
  memberships: new Set(),
  rightsByTeam: new Map(),
}

describe('gateBatchOp', () => {
  it('create root (no parent state) needs the create right', () => {
    expect(gateBatchOp(author, 'create', lib, null)).toEqual({ ok: true })
    expect(gateBatchOp(editOnly, 'create', lib, null)).toEqual({ ok: false, status: 403, code: 'forbidden' })
  })
  it('child create under an edit-locked root is blocked', () => {
    expect(gateBatchOp(author, 'create', lib, 'Effective')).toEqual({ ok: false, status: 409, code: 'edit_locked' })
    expect(gateBatchOp(author, 'create', lib, 'Draft')).toEqual({ ok: true })
  })
  it('update needs edit and an unlocked state', () => {
    expect(gateBatchOp(editOnly, 'update', lib, 'Draft')).toEqual({ ok: true })
    expect(gateBatchOp(editOnly, 'update', lib, 'Approved')).toEqual({ ok: false, status: 409, code: 'edit_locked' })
  })
  it('update without the edit right → 403', () => {
    const noRights: Principal = { ...editOnly, rightsByTeam: new Map() }
    expect(gateBatchOp(noRights, 'update', lib, 'Draft')).toEqual({ ok: false, status: 403, code: 'forbidden' })
  })
  it('delete blocked in locked states except Obsolete', () => {
    expect(gateBatchOp(author, 'delete', lib, 'Draft')).toEqual({ ok: true })
    expect(gateBatchOp(author, 'delete', lib, 'Effective')).toEqual({ ok: false, status: 409, code: 'edit_locked' })
    expect(gateBatchOp(author, 'delete', lib, 'Obsolete')).toEqual({ ok: true })
  })
  it('admin passes everything', () => {
    expect(gateBatchOp(admin, 'update', lib, 'Effective')).toEqual({ ok: true })
    expect(gateBatchOp(admin, 'delete', lib, 'Superseded')).toEqual({ ok: true })
  })
  it('delete without the delete right → 403 even with edit', () => {
    expect(gateBatchOp(editOnly, 'delete', lib, 'Draft')).toEqual({ ok: false, status: 403, code: 'forbidden' })
  })
  it('an explicit locked-set snapshot is honoured', () => {
    expect(gateBatchOp(editOnly, 'update', lib, 'Draft', new Set(['Draft']))).toEqual({
      ok: false,
      status: 409,
      code: 'edit_locked',
    })
  })
})
