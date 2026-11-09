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
import { eq } from 'drizzle-orm';
import { db } from '../lib/db';
import { migrateTestDb, resetDb } from '../test/fixture';
import { mockSessionAs, seedUser, req } from '../test/harness';
import { createWorkCenter, assignUserToWorkCenter } from 'mission-control-db/src/dao/work-centers';
import { apiClient, workflow, workCenter, runtimeSchedule, scheduleOccurrence, scheduleItemRun } from 'mission-control-db/src/db/schema/index';
import { getScheduleLateToleranceMinutes } from 'mission-control-db/src/dao/system-settings';
import { upsertMasterScheduleByKey } from 'mission-control-db/src/scheduling/master-dao';
import { fromDefinition, toDefinition } from '../../components/schedules/master-schedule-model';
import { app } from '../app';

beforeAll(async () => { await migrateTestDb(); });
beforeEach(async () => { await resetDb(); mockSessionAs(null); });

const UNKNOWN = '00000000-0000-4000-8000-000000000000';
const FUTURE = { type: 'once', at: '2999-01-10T06:00' };
const definition = (extra: Record<string, unknown> = {}) => ({
  name: 'Nightly', recurrence: FUTURE, items: [{ workflow: { name: 'Blend' } }], ...extra,
});
const spec = { starting_parameter_specifications: [], output_parameter_specifications: [] };

type World = { wc: string; admin: string; commander: string; steward: string; viewer: string };
async function world(): Promise<World> {
  const wc = (await createWorkCenter(db, { name: 'Line 1' })).id;
  const admin = await seedUser(db, { email: 'ad@x.io', displayName: 'Ad', accessLevel: 'administrator' });
  const commander = await seedUser(db, { email: 'c@x.io', displayName: 'Cmd', accessLevel: 'steward' });
  const steward = await seedUser(db, { email: 's@x.io', displayName: 'Stw', accessLevel: 'steward' });
  const viewer = await seedUser(db, { email: 'v@x.io', displayName: 'Vw', accessLevel: 'viewer' });
  await assignUserToWorkCenter(db, wc, commander, { missionSystemCommander: true });
  await assignUserToWorkCenter(db, wc, steward, {});
  await db.insert(workflow).values({
    oid: 'o-Blend', name: 'Blend', workCenterId: wc, version: '1.0.0', state: 'Effective', specJsonb: spec,
  });
  return { wc, admin, commander, steward, viewer };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response) => (await r.json()) as any;
async function makeMaster(w: World) {
  mockSessionAs(w.admin);
  const r = await req(app, 'POST', `/api/work-centers/${w.wc}/master-schedules`, { json: definition() });
  expect(r.status).toBe(201);
  return (await json(r)).id as string;
}
async function enable(w: World) {
  const m = await makeMaster(w);
  const r = await req(app, 'POST', `/api/master-schedules/${m}/enable`);
  expect(r.status).toBe(201);
  return { master: m, runtime: (await json(r)).runtime.id as string };
}

describe('remove from the list', () => {
  it('a commander removes an ended one; a live one is 409; others get 403; unknown is 404', async () => {
    const w = await world();
    const { runtime } = await enable(w);
    mockSessionAs(w.commander);
    expect((await req(app, 'POST', `/api/runtime-schedules/${runtime}/remove`)).status).toBe(409);
    expect((await req(app, 'POST', `/api/runtime-schedules/${runtime}/cancel`, { json: { reason: 'done' } })).status).toBe(204);
    for (const who of [w.steward, w.viewer]) {
      mockSessionAs(who);
      expect((await req(app, 'POST', `/api/runtime-schedules/${runtime}/remove`)).status).toBe(403);
    }
    mockSessionAs(w.commander);
    expect(await json(await req(app, 'GET', `/api/work-centers/${w.wc}/runtime-schedules`))).toHaveLength(1);
    expect((await req(app, 'POST', `/api/runtime-schedules/${runtime}/remove`)).status).toBe(204);
    expect(await json(await req(app, 'GET', `/api/work-centers/${w.wc}/runtime-schedules`))).toEqual([]);
    expect((await req(app, 'GET', `/api/runtime-schedules/${runtime}`)).status).toBe(200);
    expect((await req(app, 'POST', `/api/runtime-schedules/${UNKNOWN}/remove`)).status).toBe(404);
  });
});

describe('run once routes', () => {
  it('a commander starts it now or at a local time, and again while it is live; others get 403', async () => {
    const w = await world();
    const m = await makeMaster(w);
    mockSessionAs(w.commander);
    const first = await req(app, 'POST', `/api/master-schedules/${m}/run-once`);
    expect(first.status).toBe(201);
    expect((await json(first)).runtime).toMatchObject({ label: 'RS-1', runOnce: true, status: 'active' });
    const later = await req(app, 'POST', `/api/master-schedules/${m}/run-once`, { json: { at: '2999-01-10T06:00' } });
    expect(later.status).toBe(201);
    expect((await json(later)).runtime.label).toBe('RS-2');
    for (const who of [w.steward, w.viewer]) {
      mockSessionAs(who);
      expect((await req(app, 'POST', `/api/master-schedules/${m}/run-once`)).status).toBe(403);
    }
  });

  it('refuses a malformed body, a past time with its reason, and an unknown Master', async () => {
    const w = await world();
    const m = await makeMaster(w);
    for (const bad of [{ at: 'soon' }, { at: '2999-01-10' }, { when: '2999-01-10T06:00' }]) {
      expect((await req(app, 'POST', `/api/master-schedules/${m}/run-once`, { json: bad })).status).toBe(400);
    }
    const past = await req(app, 'POST', `/api/master-schedules/${m}/run-once`, { json: { at: '2020-01-01T00:00' } });
    expect(past.status).toBe(422);
    expect((await json(past)).error.details[0]).toMatchObject({ path: 'at', code: 'RUN_ONCE_TIME_PASSED' });
    expect((await req(app, 'POST', `/api/master-schedules/${UNKNOWN}/run-once`)).status).toBe(404);
  });

  it('every tier reads the preview and the clock', async () => {
    const w = await world();
    const m = await makeMaster(w);
    mockSessionAs(w.viewer);
    const preview = await req(app, 'GET', `/api/master-schedules/${m}/run-once-preview`);
    expect(preview.status).toBe(200);
    expect(await json(preview)).toMatchObject({ problems: [], warnings: [] });
    const clock = await json(await req(app, 'GET', `/api/work-centers/${w.wc}/schedule-clock`));
    expect(clock.workCenterZoneSet).toBe(false);
    expect(typeof clock.timeZone).toBe('string');
    expect((await req(app, 'GET', `/api/work-centers/${UNKNOWN}/schedule-clock`)).status).toBe(404);
  });

  it('a Manual Master saves, previews no times, and Enable is refused', async () => {
    const w = await world();
    mockSessionAs(w.admin);
    const created = await req(app, 'POST', `/api/work-centers/${w.wc}/master-schedules`, { json: definition({ name: 'Alarm', recurrence: { type: 'manual' } }) });
    expect(created.status).toBe(201);
    const id = (await json(created)).id as string;
    const preview = await json(await req(app, 'POST', `/api/work-centers/${w.wc}/recurrence-preview`, { json: { recurrence: { type: 'manual' } } }));
    expect(preview.nextFireTimes).toEqual([]);
    const refused = await req(app, 'POST', `/api/master-schedules/${id}/enable`);
    expect(refused.status).toBe(422);
    expect((await json(refused)).error.details[0].code).toBe('MANUAL_ONLY');
  });
});

describe('master schedule versions', () => {
  it('an edit needs a reason, makes the next version, and the record lists every version', async () => {
    const w = await world();
    const id = await makeMaster(w);
    mockSessionAs(w.commander);
    for (const bad of [{}, { changeReason: '' }, { changeReason: '   ' }, { changeReason: 7 }]) {
      expect((await req(app, 'PUT', `/api/master-schedules/${id}`, { json: { ...definition({ name: 'V2' }), ...bad } })).status).toBe(400);
    }
    const put = await req(app, 'PUT', `/api/master-schedules/${id}`, { json: { ...definition({ name: 'V2' }), changeReason: 'Second shift added' } });
    expect(put.status).toBe(200);
    expect((await json(put)).revision).toBe(2);

    mockSessionAs(w.viewer);
    const record = await json(await req(app, 'GET', `/api/master-schedules/${id}/record`));
    expect(record).toMatchObject({ workCenterName: 'Line 1', master: { id, revision: 2 } });
    expect(typeof record.timeZone).toBe('string');
    expect(record.changes.map((c: { version: number; reason: string; actorKind: string }) => [c.version, c.reason, c.actorKind])).toEqual([
      [1, 'Initial version', 'user'], [2, 'Second shift added', 'user'],
    ]);
    expect(record.changes[0].actorName).not.toBe(record.changes[1].actorName); // the admin made it, the commander changed it
    expect((await req(app, 'GET', `/api/master-schedules/${UNKNOWN}/record`)).status).toBe(404);
  });

  it('a new Master takes the reason it is given, and a reason that is not text is refused', async () => {
    const w = await world();
    mockSessionAs(w.admin);
    const r = await req(app, 'POST', `/api/work-centers/${w.wc}/master-schedules`, { json: { ...definition({ name: 'Given' }), changeReason: 'Copied from Line 2' } });
    expect(r.status).toBe(201);
    const record = await json(await req(app, 'GET', `/api/master-schedules/${(await json(r)).id}/record`));
    expect(record.changes[0].reason).toBe('Copied from Line 2');
    expect((await req(app, 'POST', `/api/work-centers/${w.wc}/master-schedules`, { json: { ...definition({ name: 'Bad' }), changeReason: 1 } })).status).toBe(400);
  });
});

describe('master schedule routes', () => {
  it('admin and flagged steward create, read, replace, delete', async () => {
    const w = await world();
    for (const who of [w.admin, w.commander]) {
      mockSessionAs(who);
      const created = await req(app, 'POST', `/api/work-centers/${w.wc}/master-schedules`, { json: definition({ name: `N-${who.slice(0, 4)}` }) });
      expect(created.status).toBe(201);
      const id = (await json(created)).id;
      expect((await req(app, 'GET', `/api/master-schedules/${id}`)).status).toBe(200);
      const put = await req(app, 'PUT', `/api/master-schedules/${id}`, { json: { ...definition({ name: 'Renamed' }), changeReason: 'Renamed for the new line' } });
      expect(put.status).toBe(200);
      expect((await json(put)).name).toBe('Renamed');
      expect((await req(app, 'DELETE', `/api/master-schedules/${id}`)).status).toBe(204);
      expect((await req(app, 'GET', `/api/master-schedules/${id}`)).status).toBe(404);
    }
  });

  it('an unflagged steward and a viewer read (200) but cannot write (403)', async () => {
    const w = await world();
    const m = await makeMaster(w);
    for (const who of [w.steward, w.viewer]) {
      mockSessionAs(who);
      expect((await req(app, 'GET', `/api/work-centers/${w.wc}/master-schedules`)).status).toBe(200);
      expect((await req(app, 'GET', `/api/master-schedules/${m}`)).status).toBe(200);
      expect((await req(app, 'POST', `/api/work-centers/${w.wc}/master-schedules`, { json: definition({ name: 'X' }) })).status).toBe(403);
      expect((await req(app, 'PUT', `/api/master-schedules/${m}`, { json: { ...definition(), changeReason: 'x' } })).status).toBe(403);
      expect((await req(app, 'DELETE', `/api/master-schedules/${m}`)).status).toBe(403);
      expect((await req(app, 'POST', `/api/master-schedules/${m}/enable`)).status).toBe(403);
      expect((await req(app, 'GET', `/api/master-schedules/${m}/enable-preview`)).status).toBe(200);
    }
    mockSessionAs(null);
    expect((await req(app, 'GET', `/api/master-schedules/${m}`)).status).toBe(401);
  });

  it('a bad definition is 400 with the problems, a duplicate name 409, a bad uuid 400, an unknown id 404', async () => {
    const w = await world();
    await makeMaster(w);
    const bad = await req(app, 'POST', `/api/work-centers/${w.wc}/master-schedules`, { json: { name: '' } });
    expect(bad.status).toBe(400);
    expect((await json(bad)).error.details).toBeTruthy();
    expect((await req(app, 'POST', `/api/work-centers/${w.wc}/master-schedules`, { json: definition() })).status).toBe(409);
    expect((await req(app, 'GET', '/api/master-schedules/not-a-uuid')).status).toBe(400);
    expect((await req(app, 'GET', `/api/master-schedules/${UNKNOWN}`)).status).toBe(404);
    expect((await req(app, 'GET', `/api/work-centers/${UNKNOWN}/master-schedules`)).status).toBe(404);
    expect((await req(app, 'POST', `/api/work-centers/${UNKNOWN}/master-schedules`, { json: definition() })).status).toBe(404);
  });

  it('recurrence-preview returns the next five times and the text; a bad recurrence is 400', async () => {
    const w = await world();
    mockSessionAs(w.viewer);
    const r = await req(app, 'POST', `/api/work-centers/${w.wc}/recurrence-preview`, {
      json: { recurrence: { type: 'daily', every: 1, times: ['06:00'], range: { startDate: '2026-01-01', noEnd: true } } },
    });
    expect(r.status).toBe(200);
    const body = await json(r);
    expect(body.nextFireTimes).toHaveLength(5);
    expect(body.recurrenceText).toContain('06:00');
    expect((await req(app, 'POST', `/api/work-centers/${w.wc}/recurrence-preview`, { json: { recurrence: { type: 'nope' } } })).status).toBe(400);
    expect((await req(app, 'POST', `/api/work-centers/${w.wc}/recurrence-preview`, { json: { recurrence: FUTURE, extra: 1 } })).status).toBe(400);
  });

  it('enable-preview and enable work; a 422 carries details; a second enable is 409', async () => {
    const w = await world();
    const m = await makeMaster(w);
    const pv = await req(app, 'GET', `/api/master-schedules/${m}/enable-preview`);
    expect(pv.status).toBe(200);
    expect((await json(pv)).nextFireTimes).toHaveLength(1);

    const en = await req(app, 'POST', `/api/master-schedules/${m}/enable`);
    expect(en.status).toBe(201);
    expect((await json(en)).runtime.label).toBe('RS-1');
    expect((await req(app, 'POST', `/api/master-schedules/${m}/enable`)).status).toBe(409);

    // A Master naming a workflow its work center does not hold cannot be enabled.
    const other = await createWorkCenter(db, { name: 'Line 2' });
    const bad = await req(app, 'POST', `/api/work-centers/${other.id}/master-schedules`, { json: definition({ name: 'Missing' }) });
    expect(bad.status).toBe(201);
    const r422 = await req(app, 'POST', `/api/master-schedules/${(await json(bad)).id}/enable`);
    expect(r422.status).toBe(422);
    expect((await json(r422)).error.details).toBeTruthy();
  });
});

describe('runtime schedule routes', () => {
  it('lists, filters by status, reads detail, occurrences and resume-preview for every tier', async () => {
    const w = await world();
    const { runtime } = await enable(w);
    for (const who of [w.viewer, w.steward]) {
      mockSessionAs(who);
      expect(await json(await req(app, 'GET', `/api/work-centers/${w.wc}/runtime-schedules`))).toHaveLength(1);
      expect(await json(await req(app, 'GET', `/api/work-centers/${w.wc}/runtime-schedules?status=paused`))).toEqual([]);
      expect((await req(app, 'GET', `/api/work-centers/${w.wc}/runtime-schedules?status=bogus`)).status).toBe(400);
      const detail = await json(await req(app, 'GET', `/api/runtime-schedules/${runtime}`));
      expect(detail.items).toHaveLength(1);
      expect(detail.items[0].specJsonb).toBeUndefined();
      expect(await json(await req(app, 'GET', `/api/runtime-schedules/${runtime}/occurrences?limit=10&offset=0`))).toEqual({ rows: [], total: 0 });
      expect((await req(app, 'GET', `/api/runtime-schedules/${runtime}/occurrences?limit=0`)).status).toBe(400);
      expect((await req(app, 'GET', `/api/runtime-schedules/${runtime}/resume-preview`)).status).toBe(200);
    }
    expect((await req(app, 'GET', `/api/runtime-schedules/${UNKNOWN}`)).status).toBe(404);
    expect((await req(app, 'GET', `/api/runtime-schedules/${UNKNOWN}/occurrences`)).status).toBe(404);
    expect((await req(app, 'GET', `/api/work-centers/${UNKNOWN}/runtime-schedules`)).status).toBe(404);
    expect((await req(app, 'GET', '/api/runtime-schedules/x')).status).toBe(400);
  });

  it('events: every tier reads the log newest first, paging is validated, an unknown Runtime is 404', async () => {
    const w = await world();
    const { runtime } = await enable(w);
    mockSessionAs(w.commander);
    expect((await req(app, 'POST', `/api/runtime-schedules/${runtime}/pause`)).status).toBe(204);
    for (const who of [w.viewer, w.steward]) {
      mockSessionAs(who);
      const page = await json(await req(app, 'GET', `/api/runtime-schedules/${runtime}/events?limit=10&offset=0`));
      expect(page.total).toBe(2);
      expect(page.rows.map((r: { action: string }) => r.action)).toEqual(['paused', 'enabled']);
      expect(page.rows[0]).toMatchObject({ actorKind: 'user' });
      expect((await req(app, 'GET', `/api/runtime-schedules/${runtime}/events?limit=0`)).status).toBe(400);
    }
    expect((await req(app, 'GET', `/api/runtime-schedules/${UNKNOWN}/events`)).status).toBe(404);
    expect((await req(app, 'GET', '/api/runtime-schedules/x/events')).status).toBe(400);
  });

  it('an unflagged steward and a viewer get 403 on every control', async () => {
    const w = await world();
    const { runtime } = await enable(w);
    const item = (await json(await req(app, 'GET', `/api/runtime-schedules/${runtime}`))).items[0].id as string;
    for (const who of [w.steward, w.viewer]) {
      mockSessionAs(who);
      const base = `/api/runtime-schedules/${runtime}`;
      expect((await req(app, 'POST', `${base}/pause`)).status).toBe(403);
      expect((await req(app, 'POST', `${base}/resume`, { json: {} })).status).toBe(403);
      expect((await req(app, 'POST', `${base}/cancel`, { json: { reason: 'x' } })).status).toBe(403);
      expect((await req(app, 'POST', `${base}/acknowledge`, { json: { runIds: 'all' } })).status).toBe(403);
      expect((await req(app, 'PUT', `${base}/items/${item}/disabled`, { json: { disabled: true } })).status).toBe(403);
    }
  });

  it.each(['admin', 'commander'] as const)('%s can pause, resume, disable and cancel; a wrong state is 409', async (role) => {
    const w = await world();
    const { runtime } = await enable(w);
    mockSessionAs(w[role]);
    const base = `/api/runtime-schedules/${runtime}`;
    expect((await req(app, 'POST', `${base}/pause`)).status).toBe(204);
    expect((await req(app, 'POST', `${base}/pause`)).status).toBe(409);
    const item = (await json(await req(app, 'GET', base))).items[0].id as string;
    expect((await req(app, 'PUT', `${base}/items/${item}/disabled`, { json: { disabled: true } })).status).toBe(204);
    expect((await json(await req(app, 'GET', base))).items[0].disabled).toBe(true);
    expect((await req(app, 'PUT', `${base}/items/${item}/disabled`, { json: { disabled: 'yes' } })).status).toBe(400);
    expect((await req(app, 'PUT', `${base}/items/${UNKNOWN}/disabled`, { json: { disabled: false } })).status).toBe(404);
    const resumed = await req(app, 'POST', `${base}/resume`, { json: {} });
    expect(resumed.status).toBe(200);
    expect(await json(resumed)).toHaveProperty('startedSlots');
    expect((await req(app, 'POST', `${base}/cancel`, { json: { reason: 'Retired' } })).status).toBe(204);
    expect((await json(await req(app, 'GET', base))).status).toBe('cancelled');
    expect((await req(app, 'POST', `${base}/cancel`, { json: { reason: 'Again' } })).status).toBe(409);
    expect((await req(app, 'POST', `${base}/pause`)).status).toBe(409);
    expect((await json(await req(app, 'POST', `${base}/pause`))).error.code).toBe('conflict');
  });

  it('resume refuses a stale expectedMissedCount before changing anything', async () => {
    const w = await world();
    const { runtime } = await enable(w);
    mockSessionAs(w.admin);
    const base = `/api/runtime-schedules/${runtime}`;
    expect((await req(app, 'POST', `${base}/pause`)).status).toBe(204);
    const stale = await req(app, 'POST', `${base}/resume`, { json: { expectedMissedCount: 5 } });
    expect(stale.status).toBe(400);
    expect((await json(stale)).error.message).toBe('The number of missed starts changed: 0 now.');
    expect((await json(await req(app, 'GET', base))).status).toBe('paused');
    expect((await req(app, 'POST', `${base}/resume`, { json: { expectedMissedCount: -1 } })).status).toBe(400);
    expect((await req(app, 'POST', `${base}/resume`, { json: { expectedMissedCount: 0 } })).status).toBe(200);
    expect((await json(await req(app, 'GET', base))).status).toBe('active');
  });

  it('cancel needs a non-blank reason (400) and a strict body; the other bodies are strict too', async () => {
    const w = await world();
    const { runtime } = await enable(w);
    const base = `/api/runtime-schedules/${runtime}`;
    mockSessionAs(w.admin);
    for (const b of [{}, { reason: '   ' }, { reason: 'ok', extra: 1 }, { reason: 5 }]) {
      const r = await req(app, 'POST', `${base}/cancel`, { json: b });
      expect(r.status).toBe(400);
      expect((await json(r)).error.code).toBe('validation');
    }
    expect((await json(await req(app, 'GET', base))).status).toBe('active');
    expect((await req(app, 'POST', `${base}/pause`, { json: { x: 1 } })).status).toBe(400);
    expect((await req(app, 'POST', `${base}/resume`, { json: { missed: 'some' } })).status).toBe(400);
    expect((await req(app, 'POST', `${base}/resume`, { json: { extra: 1 } })).status).toBe(400);
    expect((await req(app, 'POST', `${base}/acknowledge`, { json: {} })).status).toBe(400);
    expect((await req(app, 'POST', `${base}/acknowledge`, { json: { runIds: 'all', x: 1 } })).status).toBe(400);
    const ack = await req(app, 'POST', `${base}/acknowledge`, { json: { runIds: 'all' } });
    expect(ack.status).toBe(200);
    expect(await json(ack)).toEqual({ dismissed: 0 });
  });

  it('acknowledge dismisses a failed row', async () => {
    const w = await world();
    const { runtime } = await enable(w);
    const detail = await json(await req(app, 'GET', `/api/runtime-schedules/${runtime}`));
    const [occ] = await db.insert(scheduleOccurrence).values({
      runtimeScheduleId: runtime, number: 1, scheduledAt: new Date(), origin: 'on_time',
    }).returning();
    const [run] = await db.insert(scheduleItemRun).values({
      occurrenceId: occ!.id, itemId: detail.items[0].id, status: 'failed_to_start', detail: 'boom',
    }).returning();
    mockSessionAs(w.commander);
    const ack = await req(app, 'POST', `/api/runtime-schedules/${runtime}/acknowledge`, { json: { runIds: [run!.id] } });
    expect(await json(ack)).toEqual({ dismissed: 1 });
    const occs = await json(await req(app, 'GET', `/api/runtime-schedules/${runtime}/occurrences`));
    expect(occs.rows[0].runs[0].acknowledgedAt).toBeTruthy();
    const [row] = await db.select().from(runtimeSchedule).where(eq(runtimeSchedule.id, runtime));
    expect(row!.status).toBe('active');
  });
});

describe('cross work center authorization and id shapes', () => {
  it('a commander flagged on A is refused on every write and control for B, and nothing changes', async () => {
    const w = await world();
    const { master: masterA } = await enable(w);
    // Work center B with its own Master, enabled Runtime and item.
    const b = (await createWorkCenter(db, { name: 'Line B' })).id;
    await db.insert(workflow).values({ oid: 'o-BlendB', name: 'Blend', workCenterId: b, version: '1.0.0', state: 'Effective', specJsonb: spec });
    mockSessionAs(w.admin);
    const mB = (await json(await req(app, 'POST', `/api/work-centers/${b}/master-schedules`, { json: definition() }))).id as string;
    const rB = (await json(await req(app, 'POST', `/api/master-schedules/${mB}/enable`))).runtime.id as string;
    const mB2 = (await json(await req(app, 'POST', `/api/work-centers/${b}/master-schedules`, { json: definition({ name: 'Second' }) }))).id as string;
    const itemB = (await json(await req(app, 'GET', `/api/runtime-schedules/${rB}`))).items[0].id as string;
    expect(masterA).toBeTruthy();

    mockSessionAs(w.commander);
    const rBase = `/api/runtime-schedules/${rB}`;
    const statuses = [
      (await req(app, 'POST', `/api/work-centers/${b}/master-schedules`, { json: definition({ name: 'Mine' }) })).status,
      (await req(app, 'PUT', `/api/master-schedules/${mB2}`, { json: { ...definition({ name: 'Hijack' }), changeReason: 'x' } })).status,
      (await req(app, 'DELETE', `/api/master-schedules/${mB2}`)).status,
      (await req(app, 'POST', `/api/master-schedules/${mB2}/enable`)).status,
      (await req(app, 'POST', `${rBase}/pause`)).status,
      (await req(app, 'POST', `${rBase}/resume`, { json: {} })).status,
      (await req(app, 'POST', `${rBase}/cancel`, { json: { reason: 'x' } })).status,
      (await req(app, 'POST', `${rBase}/acknowledge`, { json: { runIds: 'all' } })).status,
      (await req(app, 'PUT', `${rBase}/items/${itemB}/disabled`, { json: { disabled: true } })).status,
    ];
    expect(statuses).toEqual(Array(9).fill(403));

    mockSessionAs(w.admin);
    expect((await json(await req(app, 'GET', rBase))).status).toBe('active');
    expect((await json(await req(app, 'GET', rBase))).items[0].disabled).toBe(false);
    expect((await json(await req(app, 'GET', `/api/master-schedules/${mB2}`))).name).toBe('Second');
    expect(await json(await req(app, 'GET', `/api/work-centers/${b}/master-schedules`))).toHaveLength(2);
  });

  it("runtime A's path with an item id from runtime B is 404, and the item is untouched", async () => {
    const w = await world();
    const { runtime: rA } = await enable(w);
    const b = (await createWorkCenter(db, { name: 'Line B' })).id;
    await db.insert(workflow).values({ oid: 'o-BlendB', name: 'Blend', workCenterId: b, version: '1.0.0', state: 'Effective', specJsonb: spec });
    mockSessionAs(w.admin);
    const mB = (await json(await req(app, 'POST', `/api/work-centers/${b}/master-schedules`, { json: definition() }))).id as string;
    const rB = (await json(await req(app, 'POST', `/api/master-schedules/${mB}/enable`))).runtime.id as string;
    const itemB = (await json(await req(app, 'GET', `/api/runtime-schedules/${rB}`))).items[0].id as string;
    for (const who of [w.admin, w.commander]) {
      mockSessionAs(who);
      expect((await req(app, 'PUT', `/api/runtime-schedules/${rA}/items/${itemB}/disabled`, { json: { disabled: true } })).status).toBe(404);
    }
    mockSessionAs(w.admin);
    expect((await json(await req(app, 'GET', `/api/runtime-schedules/${rB}`))).items[0].disabled).toBe(false);
  });

  it('runIds and heldChains ids that are not UUIDs are 400, not 500', async () => {
    const w = await world();
    const { runtime } = await enable(w);
    mockSessionAs(w.admin);
    const base = `/api/runtime-schedules/${runtime}`;
    expect((await req(app, 'POST', `${base}/acknowledge`, { json: { runIds: ['not-a-uuid'] } })).status).toBe(400);
    expect((await req(app, 'POST', `${base}/resume`, { json: { heldChains: { start: ['x'], skip: [] } } })).status).toBe(400);
    expect((await req(app, 'POST', `${base}/resume`, { json: { heldChains: { start: [], skip: ['x'] } } })).status).toBe(400);
    expect((await req(app, 'POST', `${base}/acknowledge`, { json: { runIds: [UNKNOWN] } })).status).toBe(200);
  });
});

describe('work center time zone', () => {
  it('saves a valid zone, clears it with null, refuses a bad one with 400', async () => {
    const w = await world();
    mockSessionAs(w.admin);
    const ok = await req(app, 'PATCH', `/api/work-centers/${w.wc}`, { json: { timeZone: 'America/Chicago' } });
    expect(ok.status).toBe(200);
    expect((await json(ok)).workCenter.timeZone).toBe('America/Chicago');
    expect((await req(app, 'PATCH', `/api/work-centers/${w.wc}`, { json: { timeZone: 'Mars/Olympus' } })).status).toBe(400);
    expect((await req(app, 'PATCH', `/api/work-centers/${w.wc}`, { json: { timeZone: 5 } })).status).toBe(400);
    const [row] = await db.select().from(workCenter).where(eq(workCenter.id, w.wc));
    expect(row!.timeZone).toBe('America/Chicago');
    const cleared = await req(app, 'PATCH', `/api/work-centers/${w.wc}`, { json: { timeZone: null } });
    expect((await json(cleared)).workCenter.timeZone).toBeNull();
  });
});

describe('late tolerance setting', () => {
  it('administrator reads and sets whole minutes 1 to 1440; others and bad values are refused', async () => {
    const w = await world();
    mockSessionAs(w.admin);
    expect((await json(await req(app, 'GET', '/api/system-settings'))).scheduleLateToleranceMinutes).toBe(15);
    const put = await req(app, 'PUT', '/api/system-settings', { json: { scheduleLateToleranceMinutes: 30 } });
    expect(put.status).toBe(200);
    expect((await json(put)).scheduleLateToleranceMinutes).toBe(30);
    expect(await getScheduleLateToleranceMinutes(db)).toBe(30);
    for (const bad of [0, 1441, 1.5, -3, '10', null]) {
      expect((await req(app, 'PUT', '/api/system-settings', { json: { scheduleLateToleranceMinutes: bad } })).status).toBe(422);
    }
    expect((await req(app, 'PUT', '/api/system-settings', { json: { scheduleLateToleranceMinutes: 1440 } })).status).toBe(200);
    expect((await req(app, 'PUT', '/api/system-settings', { json: { scheduleLateToleranceMinutes: 1 } })).status).toBe(200);
    mockSessionAs(w.commander);
    expect((await req(app, 'PUT', '/api/system-settings', { json: { scheduleLateToleranceMinutes: 20 } })).status).toBe(403);
    expect(await getScheduleLateToleranceMinutes(db)).toBe(1);
  });
});

describe('schedule workflow options', () => {
  it('lists the work center workflows with starting parameters and output ids; any signed-in reader may', async () => {
    const w = await world();
    await db.insert(workflow).values({
      oid: 'o-Pack', name: 'Pack', workCenterId: w.wc, version: '2.0.0', state: 'Approved',
      specJsonb: {
        starting_parameter_specifications: [{ id: 'BatchId', default_value: 'B1', value_type: 'literal' }],
        output_parameter_specifications: [{ id: 'Yield' }],
      },
    });
    mockSessionAs(w.viewer);
    const r = await req(app, 'GET', `/api/work-centers/${w.wc}/schedule-workflows`);
    expect(r.status).toBe(200);
    const rows = await json(r);
    expect(rows.map((x: { name: string }) => x.name)).toEqual(['Blend', 'Pack']);
    expect(rows[1]).toMatchObject({
      version: '2.0.0', state: 'Approved', outputs: ['Yield'],
      startingParameters: [{ id: 'BatchId', defaultValue: 'B1', valueType: 'literal' }],
    });
    expect((await req(app, 'GET', `/api/work-centers/${UNKNOWN}/schedule-workflows`)).status).toBe(404);
  });
});

describe('an unchanged Commander save of an API-authored Master', () => {
  it('leaves revision, the update history and "Managed by" alone', async () => {
    const w = await world();
    const clientId = '00000000-0000-4000-8000-0000000000c1';
    await db.insert(apiClient).values({ id: clientId, name: 'ERP Scheduler', tokenHash: 'h', tokenPrefix: 'p' });
    const sent = {
      name: 'Sent', description: '  ', recurrence: { type: 'daily', weekdaysOnly: true, times: ['06:00', '14:00'], range: { startDate: '2999-01-10', noEnd: true } },
      items: [{
        workflow: { name: 'Blend' }, params: {},
        chain: [{ workflow: { name: 'Blend' }, triggerOn: ['errored', 'completed'], params: { P: { value: '' } } }],
      }],
    };
    const { master } = await upsertMasterScheduleByKey(db, w.wc, 'K-1', sent, { kind: 'api_client', clientId, name: 'ERP Scheduler' });
    mockSessionAs(w.admin);
    const got = await json(await req(app, 'GET', `/api/master-schedules/${master.id}`));
    expect(got.managedBy).toBe('ERP Scheduler');
    const body = toDefinition(fromDefinition(got));
    expect(body).toEqual(sent);
    const put = await req(app, 'PUT', `/api/master-schedules/${master.id}`, { json: { ...body, changeReason: 'No change' } });
    expect(put.status).toBe(200);
    const after = await json(put);
    expect(after.revision).toBe(got.revision);
    expect(after.managedBy).toBe('ERP Scheduler');
  });
});
