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

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestFixture, resetAndSeedFixture, rawQuery, type TestFixture } from '../../routes/v2/__tests__/testSeed'
import { withTransaction } from '../../lib/db'
import { SPEC_MOVE_FLAG_SQL } from '../../actions/moveSpecs/flag'

describe('specification immutable-columns trigger and the move flag', () => {
  let f: TestFixture
  beforeAll(async () => {
    f = await setupTestFixture()
  })
  beforeEach(async () => {
    await resetAndSeedFixture(f)
  })

  const libOf = async (id: string) =>
    (await rawQuery<{ libraryId: string }>(`SELECT "libraryId" FROM "specification" WHERE "id"=$1`, [id]))[0].libraryId

  it('rejects libraryId update without the flag', async () => {
    await expect(
      rawQuery(`UPDATE "specification" SET "libraryId"=$1 WHERE "id"=$2`, [f.libPrivateId, f.rootSpecId]),
    ).rejects.toThrow(/immutable/)
    expect(await libOf(f.rootSpecId)).toBe(f.libSharedId)
  })

  it('allows libraryId update inside a transaction that set app.spec_move', async () => {
    await withTransaction(async (q) => {
      await q(SPEC_MOVE_FLAG_SQL)
      await q(`UPDATE "specification" SET "libraryId"=$1 WHERE "id"=$2`, [f.libPrivateId, f.rootSpecId])
    })
    expect(await libOf(f.rootSpecId)).toBe(f.libPrivateId)
  })

  it('still rejects id and rootSpecificationId updates with the flag set', async () => {
    await expect(
      withTransaction(async (q) => {
        await q(SPEC_MOVE_FLAG_SQL)
        await q(`UPDATE "specification" SET "id"='other-id' WHERE "id"=$1`, [f.rootSpecId])
      }),
    ).rejects.toThrow(/immutable/)
    await expect(
      withTransaction(async (q) => {
        await q(SPEC_MOVE_FLAG_SQL)
        await q(`UPDATE "specification" SET "rootSpecificationId"=$1 WHERE "id"=$2`, [
          f.privateRootSpecId,
          f.rootSpecId,
        ])
      }),
    ).rejects.toThrow(/immutable/)
  })

  it('flag does not leak past the transaction', async () => {
    await withTransaction(async (q) => {
      await q(SPEC_MOVE_FLAG_SQL)
      await q(`UPDATE "specification" SET "libraryId"=$1 WHERE "id"=$2`, [f.libPrivateId, f.rootSpecId])
    })
    await expect(
      rawQuery(`UPDATE "specification" SET "libraryId"=$1 WHERE "id"=$2`, [f.libSharedId, f.rootSpecId]),
    ).rejects.toThrow(/immutable/)
  })
})
