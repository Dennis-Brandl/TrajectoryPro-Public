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

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { db } from '../lib/db';
import { migrateTestDb, resetDb } from '../test/fixture';
import { mockSessionAs, seedUser, req } from '../test/harness';
import { workCenter, runtimeHistory, scheduleHistory } from 'mission-control-db/src/db/schema/index';
import { assignUserToWorkCenter } from 'mission-control-db/src/dao/work-centers';
import { app } from '../app';

beforeAll(async () => { await migrateTestDb(); });
beforeEach(async () => { await resetDb(); mockSessionAs(null); });

const NIL = '00000000-0000-4000-8000-000000000000';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response) => (await r.json()) as any;

async function world() {
  const [wc] = await db.insert(workCenter).values({ name: 'Line 1' }).returning();
  const [other] = await db.insert(workCenter).values({ name: 'Line 2' }).returning();
  const admin = await seedUser(db, { email: 'a@t.test', displayName: 'Admin', accessLevel: 'administrator' });
  const commander = await seedUser(db, { email: 'c@t.test', displayName: 'Cmdr' });
  const otherCommander = await seedUser(db, { email: 'o@t.test', displayName: 'Other' });
  const viewer = await seedUser(db, { email: 'v@t.test', displayName: 'Viewer' });
  await assignUserToWorkCenter(db, wc!.id, commander, { missionSystemCommander: true });
  await assignUserToWorkCenter(db, other!.id, otherCommander, { missionSystemCommander: true });
  const instanceId = '11111111-1111-4111-8111-111111111111';
  const [run] = await db.insert(runtimeHistory).values({
    workflowInstanceId: instanceId, workCenterId: wc!.id, workCenterName: 'Line 1', runtimeNumber: 4, runtimeLabel: 'RW-4',
    masterName: 'Evacuate', masterOid: 'o', masterVersion: '1.0.0', masterState: 'Effective', finalState: 'completed',
    startedAt: new Date('2026-11-09T15:00:05Z'), finishedAt: new Date('2026-11-09T15:10:00Z'), trace: [], scheduleLabel: 'RS-2',
  }).returning();
  const [pass] = await db.insert(scheduleHistory).values({
    occurrenceId: '22222222-2222-4222-8222-222222222222', workCenterId: wc!.id, workCenterName: 'Line 1',
    scheduleLabel: 'RS-2', scheduleName: 'Fire alarm', runOnce: true, timeZone: 'America/Chicago', occurrenceNumber: 1,
    scheduledAt: new Date('2026-11-09T15:00:00Z'), startedAt: new Date('2026-11-09T15:00:05Z'),
    finishedAt: new Date('2026-11-09T15:10:00Z'), origin: 'on_time',
    workflows: [{
      runId: '33333333-3333-4333-8333-333333333333', parentRunId: null, name: 'Evacuate', version: '1.0.0',
      status: 'finished', finalState: 'completed', runtimeLabel: 'RW-4', workflowInstanceId: instanceId,
      startedAt: '2026-11-09T15:00:05.000Z', finishedAt: '2026-11-09T15:10:00.000Z',
      startingValues: { Zone: 'B' }, detail: null,
    }],
  }).returning();
  return { wc: wc!, admin, commander, otherCommander, viewer, run: run!, pass: pass! };
}

describe('schedule passes in History', () => {
  it('the list carries the pass beside the workflow run, each with its kind', async () => {
    const w = await world();
    mockSessionAs(w.viewer);
    const body = await json(await req(app, 'GET', `/api/work-centers/${w.wc.id}/runtime-history`));
    expect(body.total).toBe(2);
    expect(body.history.map((h: { kind: string }) => h.kind).sort()).toEqual(['schedule', 'workflow']);
    const pass = body.history.find((h: { kind: string }) => h.kind === 'schedule');
    expect(pass).toMatchObject({ scheduleName: 'Fire alarm', runOnce: true, counts: { ran: 1, completed: 1, problems: 0, notStarted: 0 } });
    expect(pass.workflows).toBeUndefined(); // the list never ships the workflows
    const errored = await json(await req(app, 'GET', `/api/work-centers/${w.wc.id}/runtime-history?state=errored`));
    expect(errored.total).toBe(0);
  });

  it('every tier reads a pass, with links to its workflow records', async () => {
    const w = await world();
    mockSessionAs(w.viewer);
    const r = await req(app, 'GET', `/api/schedule-history/${w.pass.id}`);
    expect(r.status).toBe(200);
    const detail = await json(r);
    expect(detail.workflows[0]).toMatchObject({ name: 'Evacuate', historyId: w.run.id, startingValues: { Zone: 'B' } });
    expect((await req(app, 'GET', `/api/schedule-history/${NIL}`)).status).toBe(404);
    expect((await req(app, 'GET', '/api/schedule-history/nope')).status).toBe(400);
  });

  it('delete needs administrator or that work center\'s Mission System Commander', async () => {
    const w = await world();
    for (const who of [w.viewer, w.otherCommander]) {
      mockSessionAs(who);
      expect((await req(app, 'DELETE', `/api/schedule-history/${w.pass.id}`)).status).toBe(403);
    }
    mockSessionAs(w.commander);
    expect((await req(app, 'DELETE', `/api/schedule-history/${w.pass.id}`)).status).toBe(204);
    expect((await req(app, 'DELETE', `/api/schedule-history/${w.pass.id}`)).status).toBe(404);
    expect(await db.select().from(runtimeHistory)).toHaveLength(1); // the workflow's own record stays
  });

  it('the purge counts and clears passes with the workflow records', async () => {
    const w = await world();
    mockSessionAs(w.admin);
    const count = await json(await req(app, 'GET', '/api/runtime-history/purge-count?olderThan=2026-12-01T00:00:00Z'));
    expect(count.count).toBe(2);
    const purged = await json(await req(app, 'POST', '/api/runtime-history/purge', { json: { olderThan: '2026-12-01T00:00:00Z' } }));
    expect(purged.deleted).toBe(2);
    expect(await db.select().from(scheduleHistory)).toHaveLength(0);
  });
});
