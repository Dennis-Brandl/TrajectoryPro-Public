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
import { setEnvironmentBinding } from '../dao/environment-bindings.js';
import { setActionServerAllowlist, setActionServerTrust } from '../dao/system-settings.js';
import { actionServerWarnings } from './load-checks.js';

const env = (over: any = {}) => ({
  oid: 'e1', local_id: 'Line Env', included_actions: [], action_server_specifications: [], ...over,
});

async function setup() {
  const t = await makeTestDb();
  const [wc] = await t.db.insert(workCenter).values({ name: 'Line 1' }).returning();
  return { ...t, wcId: wc.id };
}

test('a blank URI produces no L1 warning; an ftp URI does', async () => {
  const { db, close, wcId } = await setup();
  try {
    expect(await actionServerWarnings(db, wcId, [env({ action_server_specifications: [{ name: 'AS', uri: '' }] })])).toEqual([]);
    expect(await actionServerWarnings(db, wcId, [env({ action_server_specifications: [{ name: 'AS', uri: 'ftp://x' }] })])).toEqual([
      'Environment "Line Env" has an action server "AS" with an invalid URI "ftp://x". Fix it in Designer, then re-export and re-load.',
    ]);
    expect((await actionServerWarnings(db, wcId, [env({ action_server_specifications: [{ uri: 'nonsense' }] })]))[0])
      .toContain('action server "(unnamed)"');
  } finally { await close(); }
});

test('an env with actions and no binding warns L2; one with no actions does not', async () => {
  const { db, close, wcId } = await setup();
  try {
    const msg = 'Environment "Line Env" has no action server bound in this work center. Set it under the work center\'s environment bindings before running.';
    expect(await actionServerWarnings(db, wcId, [env({ included_actions: [{ oid: 'a' }] })])).toEqual([msg]);
    expect(await actionServerWarnings(db, wcId, [env()])).toEqual([]);
    // duplicates collapse
    expect(await actionServerWarnings(db, wcId, [env({ included_actions: [{ oid: 'a' }] }), env({ included_actions: [{ oid: 'a' }] })])).toEqual([msg]);
  } finally { await close(); }
});

test('a binding outside the allowlist warns L3 in strict mode and not in loose mode', async () => {
  const { db, close, wcId } = await setup();
  try {
    await setEnvironmentBinding(db, { workCenterId: wcId, environmentOid: 'e1', serverUri: 'http://srv:9000/x', userId: null });
    await setActionServerTrust(db, 'strict');
    await setActionServerAllowlist(db, []);
    const w = await actionServerWarnings(db, wcId, [env({ included_actions: [{ oid: 'a' }] })]);
    expect(w).toEqual(['Environment "Line Env" is bound to http://srv:9000/x, which is not on the action-server allowlist. Add it under Settings → Action server trust.']);
    await setActionServerAllowlist(db, ['http://srv:9000']);
    expect(await actionServerWarnings(db, wcId, [env({ included_actions: [{ oid: 'a' }] })])).toEqual([]);
    await setActionServerAllowlist(db, []);
    await setActionServerTrust(db, 'loose');
    expect(await actionServerWarnings(db, wcId, [env({ included_actions: [{ oid: 'a' }] })])).toEqual([]);
  } finally { await close(); }
});

test('nested child environments are checked', async () => {
  const { db, close, wcId } = await setup();
  try {
    const root = { environment_specifications: [env()], children: [
      { environment_specifications: [env({ oid: 'e2', local_id: 'Child Env', action_server_specifications: [{ name: 'C', uri: 'ftp://c' }] })] },
    ] };
    const w = await actionServerWarnings(db, wcId, (await import('./environment-entry.js')).nestedEnvironmentSpecs(root));
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('"Child Env"');
  } finally { await close(); }
});
