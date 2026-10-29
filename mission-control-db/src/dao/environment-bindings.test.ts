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

import { expect, test } from 'vitest';
import { makeTestDb } from '../../test/helpers/db.js';
import { workCenter } from '../db/schema/index.js';
import { createUser } from './users.js';
import { DaoError } from './errors.js';
import {
  listEnvironmentBindings, setEnvironmentBinding, getEnvironmentBinding,
} from './environment-bindings.js';

const NIL = '00000000-0000-0000-0000-000000000000';

async function seed(db: any) {
  const [wc] = await db.insert(workCenter).values({ name: `WC-${Math.random()}` }).returning();
  const user = await createUser(db, { email: `u-${Math.random()}@t.test`, displayName: 'User' });
  return { wc, user };
}

async function expectDaoError(p: Promise<unknown>, code: string): Promise<void> {
  try {
    await p;
    expect.fail(`expected DaoError ${code}`);
  } catch (err) {
    expect(err).toBeInstanceOf(DaoError);
    expect((err as DaoError).code).toBe(code);
  }
}

test('setEnvironmentBinding: upsert creates then overwrites', async () => {
  const { db, close } = await makeTestDb();
  const { wc, user } = await seed(db);

  await setEnvironmentBinding(db, {
    workCenterId: wc.id,
    environmentOid: 'env-1',
    serverUri: 'https://server-1.test',
    userId: user.id,
  });

  let list = await listEnvironmentBindings(db, wc.id);
  expect(list).toHaveLength(1);
  expect(list[0].serverUri).toBe('https://server-1.test');

  // Overwrite
  await setEnvironmentBinding(db, {
    workCenterId: wc.id,
    environmentOid: 'env-1',
    serverUri: 'https://server-2.test',
    userId: user.id,
  });

  list = await listEnvironmentBindings(db, wc.id);
  expect(list).toHaveLength(1);
  expect(list[0].serverUri).toBe('https://server-2.test');

  await close();
});

test('setEnvironmentBinding: empty serverUri deletes the row', async () => {
  const { db, close } = await makeTestDb();
  const { wc, user } = await seed(db);

  await setEnvironmentBinding(db, {
    workCenterId: wc.id,
    environmentOid: 'env-1',
    serverUri: 'https://server-1.test',
    userId: user.id,
  });

  let list = await listEnvironmentBindings(db, wc.id);
  expect(list).toHaveLength(1);

  // Delete by setting empty string
  await setEnvironmentBinding(db, {
    workCenterId: wc.id,
    environmentOid: 'env-1',
    serverUri: '',
    userId: user.id,
  });

  list = await listEnvironmentBindings(db, wc.id);
  expect(list).toHaveLength(0);

  await close();
});

test('getEnvironmentBinding: returns the uri or null', async () => {
  const { db, close } = await makeTestDb();
  const { wc, user } = await seed(db);

  let result = await getEnvironmentBinding(db, wc.id, 'env-1');
  expect(result).toBeNull();

  await setEnvironmentBinding(db, {
    workCenterId: wc.id,
    environmentOid: 'env-1',
    serverUri: 'https://server-1.test',
    userId: user.id,
  });

  result = await getEnvironmentBinding(db, wc.id, 'env-1');
  expect(result).toBe('https://server-1.test');

  await close();
});

test('bindings are per-WC: same oid in two WCs are independent', async () => {
  const { db, close } = await makeTestDb();
  const a = await seed(db);
  const b = await seed(db);

  await setEnvironmentBinding(db, {
    workCenterId: a.wc.id,
    environmentOid: 'env-1',
    serverUri: 'https://server-a.test',
    userId: a.user.id,
  });

  await setEnvironmentBinding(db, {
    workCenterId: b.wc.id,
    environmentOid: 'env-1',
    serverUri: 'https://server-b.test',
    userId: b.user.id,
  });

  const aList = await listEnvironmentBindings(db, a.wc.id);
  const bList = await listEnvironmentBindings(db, b.wc.id);

  expect(aList).toHaveLength(1);
  expect(bList).toHaveLength(1);
  expect(aList[0].serverUri).toBe('https://server-a.test');
  expect(bList[0].serverUri).toBe('https://server-b.test');

  await close();
});

test('listEnvironmentBindings: WORK_CENTER_NOT_FOUND when WC id does not exist', async () => {
  const { db, close } = await makeTestDb();

  await expectDaoError(
    listEnvironmentBindings(db, NIL),
    'WORK_CENTER_NOT_FOUND',
  );

  await close();
});

test('setEnvironmentBinding: WORK_CENTER_NOT_FOUND when WC id does not exist', async () => {
  const { db, close } = await makeTestDb();
  const { user } = await seed(db);

  await expectDaoError(
    setEnvironmentBinding(db, {
      workCenterId: NIL,
      environmentOid: 'env-1',
      serverUri: 'https://server-1.test',
      userId: user.id,
    }),
    'WORK_CENTER_NOT_FOUND',
  );

  await close();
});
