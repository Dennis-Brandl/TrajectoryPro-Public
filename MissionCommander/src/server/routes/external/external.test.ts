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
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '../../lib/db';
import { migrateTestDb, resetDb } from '../../test/fixture';
import { mockSessionAs, seedUser, req } from '../../test/harness';
import { createWorkCenter } from 'mission-control-db/src/dao/work-centers';
import { createApiClient, type ApiClientScope } from 'mission-control-db/src/dao/api-clients';
import {
  masterSchedule, runtimeSchedule, runtimeScheduleEvent, runtimeScheduleItem, scheduleItemRun, scheduleOccurrence, workCenter, workflow,
} from 'mission-control-db/src/db/schema/index';
import { resetApiClientLimiter } from '../../middleware/api-client';
import { app } from '../../app';

const BASE = '/api/external/v1';
const NOW = '2026-11-09T00:00:00Z';
const UNKNOWN = '00000000-0000-4000-8000-000000000000';
const NOT_FOUND = { error: { code: 'not_found', message: 'Not found' } };
const ALL: ApiClientScope[] = ['schedules:read', 'schedules:write', 'schedules:control'];

beforeAll(async () => { await migrateTestDb(); });
beforeEach(async () => {
  await resetDb();
  resetApiClientLimiter();
  mockSessionAs(null);
  // Only the clock moves: the database driver's timers keep running.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => { vi.useRealTimers(); });

const spec = (params: string[], outputs: string[] = []) => ({
  starting_parameter_specifications: params.map((id) => ({ id, value_type: 'literal', default_value: '' })),
  output_parameter_specifications: outputs.map((id) => ({ id })),
});

/** Spec section 8.4's body, verbatim. */
const SECTION_8_4 = {
  name: 'PO-88123 Blend',
  recurrence: { type: 'once', at: '2026-11-10T06:00' },
  items: [
    {
      workflow: { name: 'Blend Batch' },
      params: { BatchId: { value: 'B-88123' }, Size: { value: '2500' } },
      chain: [
        {
          workflow: { name: 'Move Material' },
          triggerOn: ['completed'],
          params: { BatchId: { from: 'trigger.input', name: 'BatchId' } },
        },
        {
          workflow: { name: 'Lab Test' },
          triggerOn: ['completed'],
          params: {
            BatchId: { from: 'trigger.input', name: 'BatchId' },
            Yield: { from: 'trigger.output', name: 'Yield', fallback: 'unknown' },
          },
          chain: [
            {
              workflow: { name: 'Release Batch', version: '2.0' },
              triggerOn: ['completed'],
              params: { LabResult: { from: 'trigger.output', name: 'Result' } },
            },
          ],
        },
        {
          workflow: { name: 'Clean Equipment' },
          triggerOn: ['completed', 'stopped', 'aborted', 'errored'],
          params: { Reason: { value: 'Post-batch clean' } },
        },
      ],
    },
  ],
};

const simple = (at = '2026-11-10T06:00', extra: Record<string, unknown> = {}) => ({
  name: 'PO-1 Blend',
  recurrence: { type: 'once', at },
  items: [{ workflow: { name: 'Blend Batch' }, params: { BatchId: { value: 'B-1' } } }],
  ...extra,
});

const DAILY = { type: 'daily', every: 1, times: ['06:00'], range: { startDate: '2026-11-01', noEnd: true } };

async function addWorkflow(wc: string, name: string, s: unknown, version = '1.0.0') {
  await db.insert(workflow).values({ oid: `o-${wc}-${name}-${version}`, name, workCenterId: wc, version, state: 'Effective', specJsonb: s });
}

async function world() {
  const [wc] = await db.insert(workCenter).values({ name: 'Line 1', timeZone: 'America/Chicago' }).returning();
  const other = (await createWorkCenter(db, { name: 'Line 2' })).id;
  const admin = await seedUser(db, { email: 'ad@x.io', displayName: 'Ad', accessLevel: 'administrator' });
  await addWorkflow(wc!.id, 'Blend Batch', spec(['BatchId', 'Size'], ['Yield']));
  await addWorkflow(wc!.id, 'Move Material', spec(['BatchId']));
  await addWorkflow(wc!.id, 'Lab Test', spec(['BatchId', 'Yield'], ['Result']));
  await addWorkflow(wc!.id, 'Release Batch', spec(['LabResult']), '2.0');
  await addWorkflow(wc!.id, 'Clean Equipment', spec(['Reason']));
  await addWorkflow(other, 'Blend Batch', spec(['BatchId']));
  const client = (scopes: ApiClientScope[] = ALL, workCenterIds = [wc!.id], name = 'ERP Scheduler') =>
    createApiClient(db, { name, scopes, workCenterIds }, admin);
  const { token, client: c } = await client();
  return { wc: wc!.id, other, admin, token, clientId: c.id, client };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response) => (await r.json()) as any;
const call = (token: string, method: string, path: string, body?: unknown) =>
  req(app, method, `${BASE}${path}`, { json: body, headers: { authorization: `Bearer ${token}` } });

type W = Awaited<ReturnType<typeof world>>;
const putPath = (w: W, key = 'PO-1', query = '') => `/work-centers/${w.wc}/master-schedules/by-key/${key}${query}`;
const send = (w: W, body: unknown = simple(), query = '?enable=true', key = 'PO-1') =>
  call(w.token, 'PUT', putPath(w, key, query), body);
const runtimesOf = (masterId: string) => db.select().from(runtimeSchedule).where(eq(runtimeSchedule.masterScheduleId, masterId));
const cancelViaApi = (w: W, id: string) => call(w.token, 'POST', `/work-centers/${w.wc}/runtime-schedules/${id}/cancel`, { reason: 'No longer needed' });

let nextOccurrenceNumber = 0;
async function seedRun(runtimeId: string, status: string, extra: Record<string, unknown> = {}) {
  const [item] = await db.select({ id: runtimeScheduleItem.id }).from(runtimeScheduleItem)
    .where(eq(runtimeScheduleItem.runtimeScheduleId, runtimeId)).limit(1);
  const number = ++nextOccurrenceNumber;
  const [occ] = await db.insert(scheduleOccurrence).values({
    runtimeScheduleId: runtimeId, number, scheduledAt: new Date(Date.UTC(2026, 10, 9) + number * 60_000), origin: 'on_time',
  }).returning();
  const [run] = await db.insert(scheduleItemRun).values({ occurrenceId: occ!.id, itemId: item!.id, status, ...extra }).returning();
  return { occurrence: occ!, run: run! };
}

describe('run once', () => {
  const MANUAL = { name: 'Fire alarm', recurrence: { type: 'manual' }, items: [{ workflow: { name: 'Clean Equipment' } }] };
  const runOncePath = (w: W, id: string) => `/work-centers/${w.wc}/master-schedules/${id}/run-once`;
  const manual = async (w: W) => (await json(await send(w, MANUAL, '', 'ALARM'))).masterSchedule.id as string;

  it('a Manual Master sent by key starts now, and the answer says what was made', async () => {
    const w = await world();
    const id = await manual(w);
    const r = await call(w.token, 'POST', runOncePath(w, id));
    expect(r.status).toBe(201);
    const body = await json(r);
    expect(body.repeated).toBe(false);
    expect(body.masterSchedule.id).toBe(id);
    expect(body.runtimeSchedule).toMatchObject({ label: 'RS-1', status: 'active', timeZone: 'America/Chicago', nextFireAt: `${NOW.slice(0, 19)}Z` });
    const [row] = await runtimesOf(id);
    expect(row).toMatchObject({ runOnce: true, externalKey: null, enabledByClient: w.clientId });
  });

  it('at is read in the work center zone', async () => {
    const w = await world();
    const r = await call(w.token, 'POST', runOncePath(w, await manual(w)), { at: '2026-11-10T06:00' });
    expect(r.status).toBe(201);
    expect((await json(r)).runtimeSchedule.nextFireAt).toBe('2026-11-10T12:00:00Z');
  });

  it('a retry with the same requestId starts nothing; a new requestId starts another', async () => {
    const w = await world();
    const id = await manual(w);
    const first = await call(w.token, 'POST', runOncePath(w, id), { requestId: 'alarm-1' });
    expect(first.status).toBe(201);
    const retry = await call(w.token, 'POST', runOncePath(w, id), { requestId: 'alarm-1' });
    expect(retry.status).toBe(200);
    const body = await json(retry);
    expect(body.repeated).toBe(true);
    expect(body.runtimeSchedule.id).toBe((await json(first)).runtimeSchedule.id);
    expect(await runtimesOf(id)).toHaveLength(1);
    expect((await call(w.token, 'POST', runOncePath(w, id), { requestId: 'alarm-2' })).status).toBe(201);
    expect((await call(w.token, 'POST', runOncePath(w, id))).status).toBe(201);
    expect(await runtimesOf(id)).toHaveLength(3);
  });

  it('needs the control scope, and refuses another work center with the one 404', async () => {
    const w = await world();
    const id = await manual(w);
    const { token: readOnly } = await w.client(['schedules:read', 'schedules:write']);
    expect((await call(readOnly, 'POST', runOncePath(w, id))).status).toBe(403);
    const { token: elsewhere } = await w.client(ALL, [w.other], 'Other');
    expect((await call(elsewhere, 'POST', `/work-centers/${w.other}/master-schedules/${id}/run-once`)).status).toBe(404);
    expect((await call(elsewhere, 'POST', runOncePath(w, id))).status).toBe(404);
    expect((await call(w.token, 'POST', `/work-centers/${w.wc}/master-schedules/not-a-uuid/run-once`)).status).toBe(404);
    expect(await runtimesOf(id)).toHaveLength(0);
  });

  it('refuses a bad body, a past time and a workflow it cannot start, creating nothing', async () => {
    const w = await world();
    const id = await manual(w);
    for (const bad of [{ at: 'soon' }, { at: '2026-11-10' }, { requestId: '' }, { requestId: 'x'.repeat(201) }, { requestId: 'a\u0000b' }, { requestId: '\ud800' }, { requestId: 7 }, { when: 'now' }]) {
      expect((await call(w.token, 'POST', runOncePath(w, id), bad)).status).toBe(400);
    }
    const past = await call(w.token, 'POST', runOncePath(w, id), { at: '2020-01-01T00:00' });
    expect(past.status).toBe(422);
    const refused = await json(past);
    expect(refused.error).toMatchObject({ code: 'ENABLE_INVALID', message: '1 problem prevents this schedule from starting' });
    expect(refused.error.details[0].code).toBe('RUN_ONCE_TIME_PASSED');
    expect(await runtimesOf(id)).toHaveLength(0);
  });

  it('enable=true on a Manual Master is refused with MANUAL_ONLY, and it stays saved', async () => {
    const w = await world();
    const r = await send(w, MANUAL, '?enable=true', 'ALARM');
    expect(r.status).toBe(422);
    expect((await json(r)).error.details[0].code).toBe('MANUAL_ONLY');
    const [saved] = await db.select().from(masterSchedule).where(eq(masterSchedule.externalKey, 'ALARM'));
    expect(saved?.name).toBe('Fire alarm');
  });

  it('a Run Once does not count as the running schedule when the sender re-sends', async () => {
    const w = await world();
    const { masterSchedule: m } = await json(await send(w, simple(), ''));
    expect((await call(w.token, 'POST', runOncePath(w, m.id))).status).toBe(201);
    const enabled = await send(w);
    expect(enabled.status).toBe(201);
    const again = await send(w);
    expect(again.status).toBe(200);
    expect((await json(again)).runtimeSchedule.id).toBe((await json(enabled)).runtimeSchedule.id);
  });

  it('the audit log names the client', async () => {
    const w = await world();
    const { runtimeSchedule: r } = await json(await call(w.token, 'POST', runOncePath(w, await manual(w))));
    const rows = await db.select().from(runtimeScheduleEvent).where(eq(runtimeScheduleEvent.runtimeScheduleId, r.id));
    expect(rows.map((e) => e.action)).toEqual(['run_once']);
    expect(rows[0]).toMatchObject({ actorKind: 'api_client', actorName: 'ERP Scheduler' });
  });
});

describe('section 8.4 example', () => {
  it('request and response, by shape: nextFireAt is 12:00:00Z in America/Chicago', async () => {
    const w = await world();
    const r = await send(w, SECTION_8_4, '?enable=true', 'PO-88123');
    expect(r.status).toBe(201);
    const body = await json(r);
    expect(body).toEqual({
      masterSchedule: { id: expect.any(String), externalKey: 'PO-88123', revision: 1, source: 'api' },
      runtimeSchedule: {
        id: expect.any(String), label: 'RS-1', status: 'active',
        nextFireAt: '2026-11-10T12:00:00Z', timeZone: 'America/Chicago', warnings: [],
      },
    });
  });

  it('a 422 lists every problem, keeps the Master saved, and a corrected re-send succeeds', async () => {
    const w = await world();
    await db.delete(workflow).where(and(eq(workflow.workCenterId, w.wc), eq(workflow.name, 'Lab Test')));
    await db.delete(workflow).where(and(eq(workflow.workCenterId, w.wc), eq(workflow.name, 'Blend Batch')));
    await addWorkflow(w.wc, 'Blend Batch', spec(['Size'], ['Yield']));
    const bad = structuredClone(SECTION_8_4);
    delete (bad.items[0]!.params as Record<string, unknown>).BatchId;
    const r = await send(w, bad, '?enable=true', 'PO-88123');
    expect(r.status).toBe(422);
    const { error } = await json(r);
    expect(error.code).toBe('ENABLE_INVALID');
    expect(error.message).toBe('2 problems prevent this schedule from being enabled');
    expect(error.details).toEqual([
      expect.objectContaining({
        path: 'items[0].chain[1].workflow', code: 'WORKFLOW_NOT_FOUND',
        message: 'Master Workflow "Lab Test" not found in that work center',
      }),
      expect.objectContaining({ path: 'items[0].chain[0].params.BatchId', code: 'UNKNOWN_PARENT_PARAMETER' }),
    ]);

    const [saved] = await db.select().from(masterSchedule).where(eq(masterSchedule.externalKey, 'PO-88123'));
    expect(saved).toMatchObject({ name: 'PO-88123 Blend', revision: 1, source: 'api' });
    expect(await runtimesOf(saved!.id)).toHaveLength(0);

    await addWorkflow(w.wc, 'Lab Test', spec(['BatchId', 'Yield'], ['Result']));
    await db.delete(workflow).where(and(eq(workflow.workCenterId, w.wc), eq(workflow.name, 'Blend Batch')));
    await addWorkflow(w.wc, 'Blend Batch', spec(['BatchId', 'Size'], ['Yield']));
    const fixed = await send(w, SECTION_8_4, '?enable=true', 'PO-88123');
    expect(fixed.status).toBe(201);
    expect((await json(fixed)).masterSchedule).toMatchObject({ id: saved!.id, revision: 2 });
  });

  it('a problem count of one reads in the singular', async () => {
    const w = await world();
    const r = await send(w, simple('2026-11-10T06:00', { items: [{ workflow: { name: 'Nope' } }] }));
    expect(r.status).toBe(422);
    expect((await json(r)).error.message).toBe('1 problem prevents this schedule from being enabled');
  });
});

describe('section 8.3 re-send table', () => {
  it('none: Enable, 201', async () => {
    const w = await world();
    const r = await send(w);
    expect(r.status).toBe(201);
    const b = await json(r);
    expect(b.runtimeSchedule.label).toBe('RS-1');
    expect(b.enabled).toBeUndefined();
    expect(b.replacedRuntimeSchedule).toBeUndefined();
  });

  it('live, same revision: 200 with that Runtime, and a retry is safe', async () => {
    const w = await world();
    const first = await json(await send(w));
    for (const query of ['?enable=true', '?enable=true&replaceActive=true']) {
      const r = await send(w, simple(), query);
      expect(r.status).toBe(200);
      expect(await json(r)).toEqual(first);
    }
    expect(await runtimesOf(first.masterSchedule.id)).toHaveLength(1);
  });

  it('live, older revision: 409 every time, until replaceActive cancels and enables the new one', async () => {
    const w = await world();
    const first = await json(await send(w));
    const moved = simple('2026-11-10T08:00');
    for (let i = 0; i < 3; i++) {
      const r = await send(w, moved);
      expect(r.status).toBe(409);
      const { error } = await json(r);
      expect(error.code).toBe('RUNTIME_ACTIVE');
      expect(error.message).toContain('replaceActive');
    }
    // The body was saved, once.
    const [m] = await db.select().from(masterSchedule).where(eq(masterSchedule.id, first.masterSchedule.id));
    expect(m!.revision).toBe(2);
    expect((await runtimesOf(m!.id)).map((x) => x.status)).toEqual(['active']);

    const { run: goingRun } = await seedRun(first.runtimeSchedule.id, 'started');
    await seedRun(first.runtimeSchedule.id, 'held');
    const replaced = await send(w, moved, '?enable=true&replaceActive=true');
    expect(replaced.status).toBe(201);
    expect(await json(replaced)).toEqual({
      masterSchedule: { id: m!.id, externalKey: 'PO-1', revision: 2, source: 'api' },
      runtimeSchedule: {
        id: expect.any(String), label: 'RS-2', status: 'active',
        nextFireAt: '2026-11-10T14:00:00Z', timeZone: 'America/Chicago', warnings: [],
      },
      replacedRuntimeSchedule: { id: first.runtimeSchedule.id, label: 'RS-1', status: 'cancelled', runsStillGoing: 1, chainsCancelled: 1 },
    });
    const [old] = await db.select().from(runtimeSchedule).where(eq(runtimeSchedule.id, first.runtimeSchedule.id));
    expect(old!.status).toBe('cancelled');
    const [ev] = await db.select().from(runtimeScheduleEvent)
      .where(and(eq(runtimeScheduleEvent.runtimeScheduleId, old!.id), eq(runtimeScheduleEvent.action, 'cancelled')));
    expect((ev!.detail as { reason: string }).reason).toBe('Replaced by re-send');
    // A run already going is left alone.
    const [still] = await db.select().from(scheduleItemRun).where(eq(scheduleItemRun.id, goingRun.id));
    expect(still!.status).toBe('started');
  });

  it('replaceActive where the new Enable fails: the old Runtime stays on, and the Master stays saved', async () => {
    const w = await world();
    const first = await json(await send(w));
    const broken = simple('2026-11-10T08:00', { items: [{ workflow: { name: 'Nope' } }] });
    const r = await send(w, broken, '?enable=true&replaceActive=true');
    expect(r.status).toBe(422);
    const [old] = await db.select().from(runtimeSchedule).where(eq(runtimeSchedule.id, first.runtimeSchedule.id));
    expect(old!.status).toBe('active');
    const [m] = await db.select().from(masterSchedule).where(eq(masterSchedule.id, first.masterSchedule.id));
    expect(m!.revision).toBe(2);
  });

  it.each(['cancelled', 'finished'])('%s, same revision: 200 with enabled false, and it is not re-enabled', async (status) => {
    const w = await world();
    const first = await json(await send(w));
    if (status === 'cancelled') expect((await cancelViaApi(w, first.runtimeSchedule.id)).status).toBe(204);
    else await db.update(runtimeSchedule).set({ status, nextFireAt: null, endedAt: new Date() }).where(eq(runtimeSchedule.id, first.runtimeSchedule.id));

    const r = await send(w);
    expect(r.status).toBe(200);
    expect(await json(r)).toEqual({
      masterSchedule: first.masterSchedule,
      runtimeSchedule: { ...first.runtimeSchedule, status, nextFireAt: null },
      enabled: false,
    });
    expect(await runtimesOf(first.masterSchedule.id)).toHaveLength(1);

    // Starting it again takes POST .../enable.
    const again = await call(w.token, 'POST', `/work-centers/${w.wc}/master-schedules/${first.masterSchedule.id}/enable`);
    expect(again.status).toBe(201);
    expect((await json(again)).runtimeSchedule.label).toBe('RS-2');
  });

  it.each(['cancelled', 'finished'])('%s, older revision: Enable, 201', async (status) => {
    const w = await world();
    const first = await json(await send(w));
    if (status === 'cancelled') await cancelViaApi(w, first.runtimeSchedule.id);
    else await db.update(runtimeSchedule).set({ status, nextFireAt: null, endedAt: new Date() }).where(eq(runtimeSchedule.id, first.runtimeSchedule.id));
    const r = await send(w, simple('2026-11-10T08:00'));
    expect(r.status).toBe(201);
    const b = await json(r);
    expect(b.runtimeSchedule).toMatchObject({ label: 'RS-2', nextFireAt: '2026-11-10T14:00:00Z' });
    expect(b.enabled).toBeUndefined();
  });

  it('"the latest Runtime" is the highest runtime_number', async () => {
    const w = await world();
    const first = await json(await send(w));
    await cancelViaApi(w, first.runtimeSchedule.id);
    const again = await json(await call(w.token, 'POST', `/work-centers/${w.wc}/master-schedules/${first.masterSchedule.id}/enable`));
    await db.update(runtimeSchedule).set({ status: 'finished', nextFireAt: null }).where(eq(runtimeSchedule.id, again.runtimeSchedule.id));
    const b = await json(await send(w));
    expect(b.enabled).toBe(false);
    expect(b.runtimeSchedule.label).toBe('RS-2');
  });

  it('without enable: 201 when newly created, 200 otherwise, and an identical body keeps the revision', async () => {
    const w = await world();
    const created = await send(w, simple(), '');
    expect(created.status).toBe(201);
    const first = await json(created);
    expect(first).toEqual({ masterSchedule: { id: expect.any(String), externalKey: 'PO-1', revision: 1, source: 'api' } });

    const same = await send(w, simple(), '?enable=false');
    expect(same.status).toBe(200);
    expect(await json(same)).toEqual(first);

    const changed = await send(w, simple('2026-11-10T07:00'), '');
    expect(changed.status).toBe(200);
    expect((await json(changed)).masterSchedule.revision).toBe(2);
    expect(await runtimesOf(first.masterSchedule.id)).toHaveLength(0);
  });

  it('replaceActive only means something with enable', async () => {
    const w = await world();
    expect((await send(w, simple(), '?replaceActive=true')).status).toBe(400);
    expect((await send(w, simple(), '?enable=maybe')).status).toBe(400);
    expect((await send(w, simple(), '?other=1')).status).toBe(400);
    expect(await db.select().from(masterSchedule)).toHaveLength(0);
  });
});

describe('last write wins', () => {
  const commanderEdit = async (w: W, id: string, body: unknown) => {
    mockSessionAs(w.admin);
    const r = await req(app, 'PUT', `/api/master-schedules/${id}`, { json: { ...(body as object), changeReason: 'Commander edit' } });
    mockSessionAs(null);
    expect(r.status).toBe(200);
    return json(r);
  };

  it('a Commander edit then a re-send: the re-send wins', async () => {
    const w = await world();
    const { masterSchedule: m } = await json(await send(w, simple(), ''));
    await commanderEdit(w, m.id, simple('2026-11-10T09:00', { name: 'Edited' }));
    const r = await send(w, simple(), '');
    expect(r.status).toBe(200);
    expect((await json(r)).masterSchedule.revision).toBe(3);
    const read = await json(await call(w.token, 'GET', `/work-centers/${w.wc}/master-schedules/${m.id}`));
    expect(read).toMatchObject({ name: 'PO-1 Blend', recurrence: { at: '2026-11-10T06:00' }, source: 'api', externalKey: 'PO-1', managedBy: 'ERP Scheduler' });
  });

  it('a re-send then a Commander edit: the edit wins, and the next identical-to-old re-send still overwrites it', async () => {
    const w = await world();
    const { masterSchedule: m } = await json(await send(w, simple(), ''));
    await send(w, simple(), '');
    const edited = await commanderEdit(w, m.id, simple('2026-11-10T09:00', { name: 'Edited' }));
    expect(edited).toMatchObject({ name: 'Edited', revision: 2 });
    const r = await send(w, simple(), '');
    expect((await json(r)).masterSchedule.revision).toBe(3);
    const read = await json(await call(w.token, 'GET', `/work-centers/${w.wc}/master-schedules/${m.id}`));
    expect(read.name).toBe('PO-1 Blend');
  });
});

describe('zones', () => {
  it('a datetime without a zone is read in the work center zone, for at and startAt', async () => {
    const w = await world();
    await db.update(workCenter).set({ timeZone: 'Europe/Berlin' }).where(eq(workCenter.id, w.wc));
    const once = await json(await send(w, simple('2026-11-10T06:00'), '?enable=true', 'A'));
    expect(once.runtimeSchedule).toMatchObject({ nextFireAt: '2026-11-10T05:00:00Z', timeZone: 'Europe/Berlin' });
    const every = await json(await send(w, simple('', {
      name: 'Every', recurrence: { type: 'interval', every: 1, unit: 'hours', startAt: '2026-11-10T06:00' },
    }), '?enable=true', 'B'));
    expect(every.runtimeSchedule).toMatchObject({ nextFireAt: '2026-11-10T05:00:00Z', timeZone: 'Europe/Berlin' });
    const read = await json(await call(w.token, 'GET', `/work-centers/${w.wc}/runtime-schedules/${every.runtimeSchedule.id}`));
    expect(read).toMatchObject({ nextFireAt: '2026-11-10T05:00:00Z', timeZone: 'Europe/Berlin', enabledAt: '2026-11-09T00:00:00Z' });
  });

  it('a datetime with a zone is not accepted, so nothing can be read two ways', async () => {
    const w = await world();
    const r = await send(w, simple('2026-11-10T06:00:00Z'));
    expect(r.status).toBe(400);
    expect((await json(r)).error.code).toBe('MASTER_SCHEDULE_INVALID');
  });
});

describe('credentials and scopes', () => {
  it('no token 401, a bad token 401; a signed-in session does not count', async () => {
    const w = await world();
    mockSessionAs(w.admin);
    const none = await req(app, 'GET', `${BASE}/work-centers`);
    expect(none.status).toBe(401);
    expect(none.headers.get('www-authenticate')).toBe('Bearer');
    expect((await call('mcx_wrong', 'GET', '/work-centers')).status).toBe(401);
  });

  it('GET /work-centers returns only this client\'s, with ids and zones', async () => {
    const w = await world();
    const r = await call(w.token, 'GET', '/work-centers');
    expect(r.status).toBe(200);
    expect(await json(r)).toEqual([{ id: w.wc, name: 'Line 1', timeZone: 'America/Chicago' }]);
    const { token: reader } = await w.client(['schedules:read'], [w.wc, w.other], 'Reader');
    const two = await json(await call(reader, 'GET', '/work-centers'));
    expect(two.map((x: { id: string }) => x.id).sort()).toEqual([w.wc, w.other].sort());
    const { token: writer } = await w.client(['schedules:write'], [w.wc], 'Writer');
    expect((await call(writer, 'GET', '/work-centers')).status).toBe(403);
  });

  it('each route asks for its scope', async () => {
    const w = await world();
    const { masterSchedule: m, runtimeSchedule: rs } = await json(await send(w));
    const [detail] = [await json(await call(w.token, 'GET', `/work-centers/${w.wc}/runtime-schedules/${rs.id}`))];
    const item = detail.items[0].id as string;
    const wc = `/work-centers/${w.wc}`;
    const routes: [string, string, ApiClientScope, unknown?][] = [
      ['GET', `${wc}/workflows`, 'schedules:read'],
      ['GET', `${wc}/master-schedules`, 'schedules:read'],
      ['GET', `${wc}/master-schedules/${m.id}`, 'schedules:read'],
      ['GET', `${wc}/runtime-schedules`, 'schedules:read'],
      ['GET', `${wc}/runtime-schedules/${rs.id}`, 'schedules:read'],
      ['GET', `${wc}/runtime-schedules/${rs.id}/occurrences`, 'schedules:read'],
      ['PUT', `${wc}/master-schedules/by-key/ZZ`, 'schedules:write', simple()],
      ['DELETE', `${wc}/master-schedules/${m.id}`, 'schedules:write'],
      ['POST', `${wc}/master-schedules/${m.id}/enable`, 'schedules:control'],
      ['POST', `${wc}/runtime-schedules/${rs.id}/pause`, 'schedules:control'],
      ['POST', `${wc}/runtime-schedules/${rs.id}/resume`, 'schedules:control', {}],
      ['POST', `${wc}/runtime-schedules/${rs.id}/cancel`, 'schedules:control', { reason: 'x' }],
      ['POST', `${wc}/runtime-schedules/${rs.id}/acknowledge`, 'schedules:control', { runIds: 'all' }],
      ['PUT', `${wc}/runtime-schedules/${rs.id}/items/${item}/disabled`, 'schedules:control', { disabled: true }],
    ];
    for (const [method, path, scope, body] of routes) {
      const { token: wrong } = await w.client(ALL.filter((s) => s !== scope), [w.wc], `No ${scope}`);
      const r = await call(wrong, method, path, body);
      expect(r.status, `${method} ${path}`).toBe(403);
      expect((await json(r)).error.code).toBe('forbidden');
    }
  });

  it('PUT ?enable=true needs write and control, and a refusal saves nothing', async () => {
    const w = await world();
    const { token: writeOnly } = await w.client(['schedules:write'], [w.wc], 'W');
    expect((await call(writeOnly, 'PUT', putPath(w, 'K1', '?enable=true'), simple())).status).toBe(403);
    expect(await db.select().from(masterSchedule)).toHaveLength(0);
    const { token: controlOnly } = await w.client(['schedules:control'], [w.wc], 'C');
    expect((await call(controlOnly, 'PUT', putPath(w, 'K1', '?enable=true'), simple())).status).toBe(403);
    expect((await call(writeOnly, 'PUT', putPath(w, 'K1'), simple())).status).toBe(201);
    const { token: both } = await w.client(['schedules:write', 'schedules:control'], [w.wc], 'B');
    expect((await call(both, 'PUT', putPath(w, 'K1', '?enable=true'), simple())).status).toBe(201);
  });

  it('the failed sign-in limit answers 429 on the external routes', async () => {
    await world();
    for (let i = 0; i < 10; i++) expect((await call('mcx_wrong', 'GET', '/work-centers')).status).toBe(401);
    const r = await call('mcx_wrong', 'GET', '/work-centers');
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBeTruthy();
  });
});

describe('work center boundaries', () => {
  async function twoWorkCenters() {
    const w = await world();
    const { token } = await w.client(ALL, [w.wc, w.other], 'Both');
    const a = await json(await send(w));
    const b = await json(await call(token, 'PUT', `/work-centers/${w.other}/master-schedules/by-key/PO-2?enable=true`, simple()));
    expect(b.runtimeSchedule).toBeTruthy();
    const detail = async (wc: string, id: string) => json(await call(token, 'GET', `/work-centers/${wc}/runtime-schedules/${id}`));
    return {
      w, token, a, b,
      aItem: (await detail(w.wc, a.runtimeSchedule.id)).items[0].id as string,
      bItem: (await detail(w.other, b.runtimeSchedule.id)).items[0].id as string,
    };
  }

  const expect404 = async (r: Response) => {
    expect(r.status).toBe(404);
    expect(await json(r)).toEqual(NOT_FOUND);
  };

  it('a work center outside the list, an unknown one and a malformed one answer the same 404', async () => {
    const w = await world();
    for (const wc of [w.other, UNKNOWN, 'not-a-uuid']) {
      await expect404(await call(w.token, 'GET', `/work-centers/${wc}/workflows`));
      await expect404(await call(w.token, 'GET', `/work-centers/${wc}/master-schedules`));
      await expect404(await call(w.token, 'GET', `/work-centers/${wc}/runtime-schedules`));
      await expect404(await call(w.token, 'PUT', `/work-centers/${wc}/master-schedules/by-key/K`, simple()));
    }
    expect(await db.select().from(masterSchedule)).toHaveLength(0);
  });

  it('ids that belong to another work center answer the same 404 as ids that do not exist', async () => {
    const { w, token, a, b, aItem, bItem } = await twoWorkCenters();
    const wc = `/work-centers/${w.wc}`;
    const m = b.masterSchedule.id;
    const rs = b.runtimeSchedule.id;
    for (const [method, path, body] of [
      ['GET', `${wc}/master-schedules/${m}`],
      ['DELETE', `${wc}/master-schedules/${m}`],
      ['POST', `${wc}/master-schedules/${m}/enable`],
      ['GET', `${wc}/runtime-schedules/${rs}`],
      ['GET', `${wc}/runtime-schedules/${rs}/occurrences`],
      ['POST', `${wc}/runtime-schedules/${rs}/pause`],
      ['POST', `${wc}/runtime-schedules/${rs}/resume`, {}],
      ['POST', `${wc}/runtime-schedules/${rs}/cancel`, { reason: 'x' }],
      ['POST', `${wc}/runtime-schedules/${rs}/acknowledge`, { runIds: 'all' }],
      ['PUT', `${wc}/runtime-schedules/${rs}/items/${bItem}/disabled`, { disabled: true }],
      // An item of another Runtime, under a Runtime this path may use.
      ['PUT', `${wc}/runtime-schedules/${a.runtimeSchedule.id}/items/${bItem}/disabled`, { disabled: true }],
    ] as [string, string, unknown?][]) {
      await expect404(await call(token, method, path, body));
    }
    // Nothing moved in the other work center.
    const [other] = await db.select().from(runtimeSchedule).where(eq(runtimeSchedule.id, rs));
    expect(other!.status).toBe('active');
    expect(aItem).not.toBe(bItem);
  });

  it('malformed and unknown ids answer the same 404', async () => {
    const { w, token, a, aItem } = await twoWorkCenters();
    const wc = `/work-centers/${w.wc}`;
    for (const bad of [UNKNOWN, 'not-a-uuid']) {
      for (const [method, path, body] of [
        ['GET', `${wc}/master-schedules/${bad}`],
        ['DELETE', `${wc}/master-schedules/${bad}`],
        ['POST', `${wc}/master-schedules/${bad}/enable`],
        ['GET', `${wc}/runtime-schedules/${bad}`],
        ['GET', `${wc}/runtime-schedules/${bad}/occurrences`],
        ['POST', `${wc}/runtime-schedules/${bad}/pause`],
        ['POST', `${wc}/runtime-schedules/${bad}/cancel`, { reason: 'x' }],
        ['PUT', `${wc}/runtime-schedules/${bad}/items/${aItem}/disabled`, { disabled: true }],
        ['PUT', `${wc}/runtime-schedules/${a.runtimeSchedule.id}/items/${bad}/disabled`, { disabled: true }],
      ] as [string, string, unknown?][]) {
        await expect404(await call(token, method, path, body));
      }
    }
  });

  it('a by-key send in another work center is a different Master', async () => {
    const { w, token } = await twoWorkCenters();
    const here = await json(await send(w, simple('2026-11-10T06:00', { name: 'Here' }), '', 'SHARED'));
    const there = await json(await call(token, 'PUT', `/work-centers/${w.other}/master-schedules/by-key/SHARED`, simple('2026-11-10T06:00', { name: 'Other' })));
    expect(here.masterSchedule.id).not.toBe(there.masterSchedule.id);
  });
});

describe('reads', () => {
  it('workflows: name, version, state, starting parameters and outputs', async () => {
    const w = await world();
    const rows = await json(await call(w.token, 'GET', `/work-centers/${w.wc}/workflows`));
    expect(rows.find((r: { name: string }) => r.name === 'Lab Test')).toEqual({
      name: 'Lab Test', version: '1.0.0', state: 'Effective',
      startingParameters: [
        { id: 'BatchId', description: null, defaultValue: '', valueType: 'literal' },
        { id: 'Yield', description: null, defaultValue: '', valueType: 'literal' },
      ],
      outputs: ['Result'],
    });
  });

  it('master list and read give UTC instants with the zone; delete leaves the Runtime on', async () => {
    const w = await world();
    const { masterSchedule: m, runtimeSchedule: rs } = await json(await send(w));
    const list = await json(await call(w.token, 'GET', `/work-centers/${w.wc}/master-schedules`));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: m.id, externalKey: 'PO-1', timeZone: 'America/Chicago' });
    expect(list[0].updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    const one = await json(await call(w.token, 'GET', `/work-centers/${w.wc}/master-schedules/${m.id}`));
    expect(one).toMatchObject({ id: m.id, timeZone: 'America/Chicago', items: [{ workflow: { name: 'Blend Batch' } }] });

    expect((await call(w.token, 'DELETE', `/work-centers/${w.wc}/master-schedules/${m.id}`)).status).toBe(204);
    expect((await call(w.token, 'GET', `/work-centers/${w.wc}/master-schedules/${m.id}`)).status).toBe(404);
    const [left] = await db.select().from(runtimeSchedule).where(eq(runtimeSchedule.id, rs.id));
    expect(left!.status).toBe('active');
  });

  it('runtime list filters by status, and detail shows the tree, disabled flags and no spec', async () => {
    const w = await world();
    const { runtimeSchedule: rs } = await json(await send(w, SECTION_8_4));
    const wc = `/work-centers/${w.wc}`;
    expect(await json(await call(w.token, 'GET', `${wc}/runtime-schedules?status=paused`))).toEqual([]);
    const active = await json(await call(w.token, 'GET', `${wc}/runtime-schedules?status=active`));
    expect(active.map((r: { id: string }) => r.id)).toEqual([rs.id]);
    expect(active[0].nextFireAt).toBe('2026-11-10T12:00:00Z');
    expect((await call(w.token, 'GET', `${wc}/runtime-schedules?status=bogus`)).status).toBe(400);

    const text = await (await call(w.token, 'GET', `${wc}/runtime-schedules/${rs.id}`)).text();
    expect(text).not.toMatch(/spec_?jsonb/i);
    const detail = JSON.parse(text);
    expect(detail).toMatchObject({ status: 'active', nextFireAt: '2026-11-10T12:00:00Z', missedCount: 0, missedMore: false });
    expect(detail.items[0].masterName).toBe('Blend Batch');
    expect(detail.items[0].children).toHaveLength(3);
    expect(detail.items[0].disabled).toBe(false);
  });

  it('occurrences are paged, capped at 100, with endings and outputs; a run not yet ended has none', async () => {
    const w = await world();
    const { runtimeSchedule: rs } = await json(await send(w));
    const wc = `/work-centers/${w.wc}/runtime-schedules/${rs.id}/occurrences`;
    const ended = await seedRun(rs.id, 'finished', {
      runtimeLabel: 'RW-1', finalState: 'completed', finishedAt: new Date('2026-11-10T13:00:00.250Z'),
      triggerValues: { inputs: { BatchId: 'B-1' }, outputs: { Yield: '97' } },
    });
    const going = await seedRun(rs.id, 'started', { runtimeLabel: 'RW-2', triggerValues: { inputs: { BatchId: 'B-2' }, outputs: {} } });
    const failed = await seedRun(rs.id, 'failed_to_start', { detail: 'No such role' });

    const page = await json(await call(w.token, 'GET', `${wc}?limit=100&offset=0`));
    expect(page.total).toBe(3);
    expect(page.limit).toBe(100);
    expect(page.offset).toBe(0);
    expect(page.timeZone).toBe('America/Chicago');
    const runOf = (id: string) => page.rows.flatMap((o: { runs: { id: string }[] }) => o.runs).find((x: { id: string }) => x.id === id);
    expect(runOf(ended.run.id)).toEqual({
      id: ended.run.id, itemId: ended.run.itemId, workflowName: 'Blend Batch', parentRunId: null,
      runtimeLabel: 'RW-1', status: 'finished', ending: 'completed', finishedAt: '2026-11-10T13:00:00Z',
      detail: null, acknowledgedAt: null, outputs: { Yield: '97' },
    });
    expect(runOf(going.run.id).outputs).toBeUndefined();
    expect(runOf(going.run.id).ending).toBeNull();
    expect(runOf(failed.run.id)).toMatchObject({ status: 'failed_to_start', detail: 'No such role', ending: null });
    expect(runOf(failed.run.id).outputs).toBeUndefined();

    const one = await json(await call(w.token, 'GET', `${wc}?limit=1&offset=1`));
    expect(one.rows).toHaveLength(1);
    expect(one.total).toBe(3);
    expect(one.rows[0].id).toBe(page.rows[1].id);

    expect((await call(w.token, 'GET', `${wc}?limit=101`)).status).toBe(400);
    expect((await call(w.token, 'GET', `${wc}?limit=0`)).status).toBe(400);
    expect((await call(w.token, 'GET', `${wc}?offset=-1`)).status).toBe(400);
    expect((await call(w.token, 'GET', `${wc}?other=1`)).status).toBe(400);
  });
});

describe('controls', () => {
  const daily = (name = 'Daily') => ({ name, recurrence: DAILY, items: [{ workflow: { name: 'Blend Batch' } }] });

  it('pause, resume 202 with counts; missed is required when any were missed', async () => {
    const w = await world();
    const { runtimeSchedule: rs } = await json(await send(w, daily()));
    const path = `/work-centers/${w.wc}/runtime-schedules/${rs.id}`;
    expect((await call(w.token, 'POST', `${path}/pause`)).status).toBe(204);
    expect((await call(w.token, 'POST', `${path}/pause`, { x: 1 })).status).toBe(400);
    expect((await call(w.token, 'POST', `${path}/pause`)).status).toBe(409);

    vi.setSystemTime(new Date('2026-11-12T00:00:00Z'));
    const detail = await json(await call(w.token, 'GET', path));
    expect(detail).toMatchObject({ status: 'paused', missedCount: 3, missedMore: false });

    const missing = await call(w.token, 'POST', `${path}/resume`, {});
    expect(missing.status).toBe(400);
    expect((await json(missing)).error.code).toBe('RESUME_CHOICE_REQUIRED');
    const noBody = await call(w.token, 'POST', `${path}/resume`);
    expect(noBody.status).toBe(400);
    expect((await json(noBody)).error.code).toBe('RESUME_CHOICE_REQUIRED');

    const stale = await call(w.token, 'POST', `${path}/resume`, { missed: 'skip', expectedMissedCount: 2 });
    expect(stale.status).toBe(400);
    expect((await json(stale)).error.code).toBe('RESUME_CHOICE_REQUIRED');

    expect((await call(w.token, 'POST', `${path}/resume`, { missed: 'bogus' })).status).toBe(400);
    expect((await call(w.token, 'POST', `${path}/resume`, { missed: 'skip', extra: 1 })).status).toBe(400);

    const ok = await call(w.token, 'POST', `${path}/resume`, { missed: 'latest', heldChains: 'skip', expectedMissedCount: 3 });
    expect(ok.status).toBe(202);
    expect(await json(ok)).toEqual({ startedSlots: 1, startedChains: 0, skippedSlots: 2, skippedChains: 0, missedMore: false });
  });

  it('resume with nothing missed needs no body, and reports missedMore past the limit', async () => {
    const w = await world();
    const { runtimeSchedule: rs } = await json(await send(w, daily()));
    const path = `/work-centers/${w.wc}/runtime-schedules/${rs.id}`;
    await call(w.token, 'POST', `${path}/pause`);
    const r = await call(w.token, 'POST', `${path}/resume`);
    expect(r.status).toBe(202);
    expect((await json(r)).missedMore).toBe(false);

    // Well over 500 days paused.
    await call(w.token, 'POST', `${path}/pause`);
    vi.setSystemTime(new Date('2028-11-12T00:00:00Z'));
    const many = await call(w.token, 'POST', `${path}/resume`, { missed: 'skip' });
    expect(many.status).toBe(202);
    expect((await json(many)).missedMore).toBe(true);
  });

  it('cancel needs a reason, and body envelopes are strict', async () => {
    const w = await world();
    const { runtimeSchedule: rs } = await json(await send(w));
    const path = `/work-centers/${w.wc}/runtime-schedules/${rs.id}`;
    expect((await call(w.token, 'POST', `${path}/cancel`)).status).toBe(400);
    expect((await call(w.token, 'POST', `${path}/cancel`, { reason: '  ' })).status).toBe(400);
    expect((await call(w.token, 'POST', `${path}/cancel`, { reason: 'x', extra: 1 })).status).toBe(400);
    expect((await call(w.token, 'POST', `${path}/cancel`, { reason: 'Plan changed' })).status).toBe(204);
    const again = await call(w.token, 'POST', `${path}/cancel`, { reason: 'Plan changed' });
    expect(again.status).toBe(409);
    expect((await json(again)).error.code).toBe('RUNTIME_SCHEDULE_STATE');
  });

  it('item disabled and acknowledge', async () => {
    const w = await world();
    const { runtimeSchedule: rs } = await json(await send(w));
    const path = `/work-centers/${w.wc}/runtime-schedules/${rs.id}`;
    const item = (await json(await call(w.token, 'GET', path))).items[0].id;
    expect((await call(w.token, 'PUT', `${path}/items/${item}/disabled`, { disabled: 'yes' })).status).toBe(400);
    expect((await call(w.token, 'PUT', `${path}/items/${item}/disabled`, { disabled: true })).status).toBe(204);
    expect((await json(await call(w.token, 'GET', path))).items[0].disabled).toBe(true);

    await seedRun(rs.id, 'failed_to_start', { detail: 'boom' });
    expect((await call(w.token, 'POST', `${path}/acknowledge`, {})).status).toBe(400);
    const ack = await call(w.token, 'POST', `${path}/acknowledge`, { runIds: 'all' });
    expect(ack.status).toBe(200);
    expect(await json(ack)).toEqual({ dismissed: 1 });
  });

  it('enable on a Master already on is 409 RUNTIME_ACTIVE', async () => {
    const w = await world();
    const { masterSchedule: m } = await json(await send(w));
    const r = await call(w.token, 'POST', `/work-centers/${w.wc}/master-schedules/${m.id}/enable`);
    expect(r.status).toBe(409);
    expect((await json(r)).error.code).toBe('RUNTIME_ACTIVE');
  });

  it('audit rows name the client', async () => {
    const w = await world();
    const { masterSchedule: m, runtimeSchedule: rs } = await json(await send(w));
    const path = `/work-centers/${w.wc}/runtime-schedules/${rs.id}`;
    await call(w.token, 'POST', `${path}/pause`);
    await call(w.token, 'POST', `${path}/resume`, { missed: 'skip' });
    await call(w.token, 'POST', `${path}/cancel`, { reason: 'Done' });
    // Event rows have no foreign keys, so the per-test reset leaves other tests' rows: read this test's.
    const rows = (await db.select().from(runtimeScheduleEvent))
      .filter((r) => r.masterScheduleId === m.id || r.runtimeScheduleId === rs.id);
    const actions = rows.map((r) => r.action);
    for (const a of ['master_created', 'enabled', 'paused', 'resumed', 'cancelled']) expect(actions).toContain(a);
    for (const row of rows) {
      expect(row).toMatchObject({ actorKind: 'api_client', actorId: w.clientId, actorName: 'ERP Scheduler' });
    }
    const [enabledRow] = await db.select().from(runtimeSchedule).where(eq(runtimeSchedule.id, rs.id));
    expect(enabledRow).toMatchObject({ enabledByClient: w.clientId, enabledByUser: null });
    expect(m.source).toBe('api');
  });
});

describe('bad input', () => {
  it('a bad definition is 400 MASTER_SCHEDULE_INVALID with details', async () => {
    const w = await world();
    const r = await send(w, { name: '', items: [] });
    expect(r.status).toBe(400);
    const { error } = await json(r);
    expect(error.code).toBe('MASTER_SCHEDULE_INVALID');
    expect(error.details.map((d: { code: string }) => d.code)).toEqual(expect.arrayContaining(['NAME_REQUIRED', 'ITEMS_REQUIRED']));
  });

  it('a body that is not JSON or not an object is MASTER_SCHEDULE_INVALID too', async () => {
    const w = await world();
    const raw = (body: string) => app.request(`${BASE}${putPath(w)}`, {
      method: 'PUT', headers: { authorization: `Bearer ${w.token}`, 'content-type': 'application/json' }, body,
    });
    for (const body of ['{nope', '[]', 'null', '']) {
      const r = await raw(body);
      expect(r.status, body).toBe(400);
      expect((await json(r)).error.code).toBe('MASTER_SCHEDULE_INVALID');
    }
    expect((await json(await raw(JSON.stringify(simple('2026-11-10T06:00', { name: 'Bad\u0000Name' }))))).error.code).toBe('MASTER_SCHEDULE_INVALID');
  });

  it('a name already used by another Master here is 409', async () => {
    const w = await world();
    await send(w, simple(), '', 'K1');
    const r = await send(w, simple(), '', 'K2');
    expect(r.status).toBe(409);
    expect((await json(r)).error.code).toBe('MASTER_SCHEDULE_NAME_CONFLICT');
  });

  it('a key that is too long or holds a control character is 400 and saves nothing', async () => {
    const w = await world();
    expect((await send(w, simple(), '', 'x'.repeat(201))).status).toBe(400);
    expect((await send(w, simple(), '', 'a%00b')).status).toBe(400);
    expect(await db.select().from(masterSchedule)).toHaveLength(0);
    expect((await send(w, simple(), '', 'PO%2088123%2FA')).status).toBe(201);
    const [m] = await db.select().from(masterSchedule);
    expect(m!.externalKey).toBe('PO 88123/A');
  });

  it('a body over 1 MB is 413', async () => {
    const w = await world();
    const r = await send(w, simple('2026-11-10T06:00', { description: 'x'.repeat(1024 * 1024) }));
    expect(r.status).toBe(413);
    expect((await json(r)).error.code).toBe('too_large');
    expect(await db.select().from(masterSchedule)).toHaveLength(0);
  });

  it('an unknown path under the interface is the plain 404, after the token check', async () => {
    const w = await world();
    expect(await json(await call(w.token, 'GET', '/nothing'))).toEqual(NOT_FOUND);
    expect((await req(app, 'GET', `${BASE}/nothing`)).status).toBe(401);
  });
});

describe('the send query is read one way', () => {
  it.each([
    ['en%61ble=true&enable=false'],
    ['enable=false&en%61ble=true'],
    ['en%61ble=true&enable='],
    ['%65nable=true'],
    ['enable=tru%65'],
    ['enable=false&en%61ble=true&replaceActive=true'],
    ['replaceActive=false&repl%61ceActive=true'],
    ['repl%61ceActive=true&replaceActive='],
    ['en%61ble=true&enable=false&repl%61ceActive=true&replaceActive=false'],
  ])('a write-only client sending %s gets 403, and nothing is saved or started', async (query) => {
    const w = await world();
    const { token } = await w.client(['schedules:write'], [w.wc], 'Write only');
    const r = await call(token, 'PUT', putPath(w, 'K1', `?${query}`), simple());
    expect(r.status).toBe(403);
    expect((await json(r)).error.code).toBe('forbidden');
    expect(await db.select().from(masterSchedule)).toHaveLength(0);
    expect(await db.select().from(runtimeSchedule)).toHaveLength(0);
  });

  it('a write-only client cannot cancel a running Runtime, or change the Master behind it, that way', async () => {
    const w = await world();
    const first = await json(await send(w));
    const { token } = await w.client(['schedules:write'], [w.wc], 'Write only');
    const r = await call(token, 'PUT', putPath(w, 'PO-1', '?en%61ble=true&enable=false&repl%61ceActive=true&replaceActive=false'), simple('2026-11-10T08:00'));
    expect(r.status).toBe(403);
    const [old] = await db.select().from(runtimeSchedule).where(eq(runtimeSchedule.id, first.runtimeSchedule.id));
    expect(old!.status).toBe('active');
    const [m] = await db.select().from(masterSchedule).where(eq(masterSchedule.id, first.masterSchedule.id));
    expect(m).toMatchObject({ revision: 1, recurrence: { at: '2026-11-10T06:00' } });
  });

  it.each(['enable=true&enable=false', 'en%61ble=true&enable=false', 'en%61ble=true&enable=', 'enable=false&enable=false', 'Enable=true'])(
    'a client with every scope sending %s gets 400, and nothing is saved', async (query) => {
      const w = await world();
      expect((await send(w, simple(), `?${query}`)).status).toBe(400);
      expect(await db.select().from(masterSchedule)).toHaveLength(0);
    },
  );

  it('an encoded key that is not repeated means what it says', async () => {
    const w = await world();
    const r = await send(w, simple(), '?en%61ble=true');
    expect(r.status).toBe(201);
    expect((await json(r)).runtimeSchedule.label).toBe('RS-1');
  });
});

describe('unknown fields are refused', () => {
  const base = simple();
  it.each([
    ['chains', { ...base, items: [{ ...base.items[0], chains: [] }] }, 'items[0].chains'],
    ['parms', { ...base, items: [{ ...base.items[0], parms: {} }] }, 'items[0].parms'],
    ['versoin', { ...base, items: [{ workflow: { name: 'Blend Batch', versoin: '1.0.0' } }] }, 'items[0].workflow.versoin'],
    ['weekdayOnly', { ...base, recurrence: { type: 'daily', every: 1, weekdayOnly: true, times: ['06:00'], range: { startDate: '2026-11-01', noEnd: true } } }, 'recurrence.weekdayOnly'],
    ['rangee', { ...base, recurrence: { type: 'interval', every: 1, unit: 'hours', startAt: '2026-11-10T06:00', rangee: { noEnd: true } } }, 'recurrence.rangee'],
    ['a field inside range', { ...base, recurrence: { type: 'interval', every: 1, unit: 'hours', startAt: '2026-11-10T06:00', range: { noEnd: true, ends: 3 } } }, 'recurrence.range.ends'],
    ['a top-level field', { ...base, nmae: 'x' }, 'nmae'],
  ])('%s: 400 with a row naming the field, and nothing saved', async (_name, body, path) => {
    const w = await world();
    const r = await send(w, body);
    expect(r.status).toBe(400);
    const { error } = await json(r);
    expect(error.code).toBe('MASTER_SCHEDULE_INVALID');
    expect(error.details).toContainEqual(expect.objectContaining({ path, code: 'UNKNOWN_FIELD' }));
    expect(await db.select().from(masterSchedule)).toHaveLength(0);
  });

  it('a misspelled correction is refused, and does not look like a no-op', async () => {
    const w = await world();
    const first = await json(await send(w));
    const corrected = { ...base, items: [{ workflow: { name: 'Blend Batch' }, parms: { BatchId: { value: 'B-2' } } }] };
    const r = await send(w, corrected);
    expect(r.status).toBe(400);
    expect((await json(r)).error.details).toContainEqual(expect.objectContaining({ path: 'items[0].parms' }));
    const [m] = await db.select().from(masterSchedule).where(eq(masterSchedule.id, first.masterSchedule.id));
    expect(m!.revision).toBe(1);
  });

  it('a Master read back with its extra fields cannot be sent as is', async () => {
    const w = await world();
    const { masterSchedule: m } = await json(await send(w));
    const read = await json(await call(w.token, 'GET', `/work-centers/${w.wc}/master-schedules/${m.id}`));
    const r = await send(w, read);
    expect(r.status).toBe(400);
    const rows = (await json(r)).error.details.map((d: { path: string }) => d.path);
    expect(rows).toEqual(expect.arrayContaining(['id', 'revision', 'source', 'externalKey', 'recurrenceText', 'timeZone']));
  });

  it('the session route refuses them too', async () => {
    const w = await world();
    mockSessionAs(w.admin);
    const r = await req(app, 'POST', `/api/work-centers/${w.wc}/master-schedules`, { json: { ...base, chains: [] } });
    expect(r.status).toBe(400);
    expect((await json(r)).error.details).toContainEqual(expect.objectContaining({ path: 'chains', code: 'UNKNOWN_FIELD' }));
  });
});

describe('NUL characters', () => {
  const raw = (w: W, path: string, method: string, body: string) => app.request(`${BASE}${path}`, {
    method, headers: { authorization: `Bearer ${w.token}`, 'content-type': 'application/json' }, body,
  });

  it('a real NUL names its place, in plain words', async () => {
    const w = await world();
    const r = await raw(w, putPath(w), 'PUT', JSON.stringify(simple('2026-11-10T06:00', { description: 'bad\u0000text' })));
    expect(r.status).toBe(400);
    const { error } = await json(r);
    expect(error.code).toBe('MASTER_SCHEDULE_INVALID');
    expect(error.details).toEqual([expect.objectContaining({ path: 'description', code: 'TEXT_INVALID', message: expect.stringContaining('NUL') })]);
  });

  it('an escaped backslash followed by u0000 is ordinary text', async () => {
    const w = await world();
    const description = 'C:\\u0000';
    const body = JSON.stringify(simple('2026-11-10T06:00', { description }));
    expect(body).toContain('\\\\u0000');
    const r = await raw(w, putPath(w), 'PUT', body);
    expect(r.status).toBe(201);
    const [m] = await db.select().from(masterSchedule);
    expect(m!.description).toBe(description);
  });

  it('cancel says so instead of asking for a reason', async () => {
    const w = await world();
    const { runtimeSchedule: rs } = await json(await send(w));
    const path = `/work-centers/${w.wc}/runtime-schedules/${rs.id}/cancel`;
    const nul = await raw(w, path, 'POST', JSON.stringify({ reason: 'a\u0000b' }));
    expect(nul.status).toBe(400);
    expect((await json(nul)).error.message).toContain('NUL');
    expect((await raw(w, path, 'POST', JSON.stringify({ reason: 'C:\\u0000' }))).status).toBe(204);
  });
});

describe('text and shapes the database cannot store', () => {
  const raw = (w: W, body: string) => app.request(`${BASE}${putPath(w)}`, {
    method: 'PUT', headers: { authorization: `Bearer ${w.token}`, 'content-type': 'application/json' }, body,
  });

  it('a body nested 10,000 levels deep is a 400, not a 500', async () => {
    const w = await world();
    const deep = `${'['.repeat(10_000)}${']'.repeat(10_000)}`;
    const prefix = JSON.stringify(simple()).slice(0, -1);
    const r = await raw(w, `${prefix},"description":${deep}}`);
    expect(r.status).toBe(400);
    const { error } = await json(r);
    expect(error.code).toBe('MASTER_SCHEDULE_INVALID');
    expect(error.details).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'NESTED_TOO_DEEP' })]));
    expect(await db.select().from(masterSchedule)).toEqual([]);
  });

  it('a lone surrogate is a 400 with TEXT_INVALID, in a name and in a value', async () => {
    const w = await world();
    for (const body of [
      simple('2026-11-10T06:00', { name: 'PO-\ud800' }),
      simple('2026-11-10T06:00', { items: [{ workflow: { name: 'Blend Batch' }, params: { BatchId: { value: 'x\udc00' } } }] }),
    ]) {
      const r = await raw(w, JSON.stringify(body));
      expect(r.status).toBe(400);
      const { error } = await json(r);
      expect(error.code).toBe('MASTER_SCHEDULE_INVALID');
      expect(error.details).toEqual([expect.objectContaining({ code: 'TEXT_INVALID' })]);
    }
    expect(await db.select().from(masterSchedule)).toEqual([]);
  });

  it('a name the parser trims still retries: 201, then 200', async () => {
    const w = await world();
    const body = simple('2026-11-10T06:00', { name: '  PO-1 Blend  ' });
    const first = await send(w, body);
    expect(first.status).toBe(201);
    const retry = await send(w, body);
    expect(retry.status).toBe(200);
    expect((await json(retry)).runtimeSchedule.id).toBe((await json(first)).runtimeSchedule.id);
  });
});

describe('a re-send is decided by content', () => {
  const editInCommander = async (w: W, id: string, body: unknown) => {
    mockSessionAs(w.admin);
    expect((await req(app, 'PUT', `/api/master-schedules/${id}`, { json: { ...(body as object), changeReason: 'Commander edit' } })).status).toBe(200);
    mockSessionAs(null);
  };
  const del = (w: W, id: string) => call(w.token, 'DELETE', `/work-centers/${w.wc}/master-schedules/${id}`);
  const liveCount = async () => (await db.select().from(runtimeSchedule))
    .filter((r) => r.status === 'active' || r.status === 'paused').length;

  it('a Runtime records its key and the hash of what it froze; a Commander one has no key', async () => {
    const w = await world();
    const { runtimeSchedule: rs } = await json(await send(w));
    const [row] = await db.select().from(runtimeSchedule).where(eq(runtimeSchedule.id, rs.id));
    expect(row!.externalKey).toBe('PO-1');
    expect(row!.definitionHash).toMatch(/^[0-9a-f]{64}$/);
    mockSessionAs(w.admin);
    const made = await json(await req(app, 'POST', `/api/work-centers/${w.wc}/master-schedules`, { json: simple('2026-11-10T06:00', { name: 'By hand' }) }));
    const on = await json(await req(app, 'POST', `/api/master-schedules/${made.id}/enable`));
    const [hand] = await db.select().from(runtimeSchedule).where(eq(runtimeSchedule.id, on.runtime.id));
    expect(hand!.externalKey).toBeNull();
    expect(hand!.definitionHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('what Enable froze hashes the same as what was sent, for the whole of 8.4, in any key order', async () => {
    const w = await world();
    const first = await json(await send(w, { ...SECTION_8_4, description: '' }));
    const reordered = { description: '', items: SECTION_8_4.items, recurrence: { at: '2026-11-10T06:00', type: 'once' }, name: SECTION_8_4.name };
    const r = await send(w, reordered);
    expect(r.status).toBe(200);
    expect((await json(r)).runtimeSchedule.id).toBe(first.runtimeSchedule.id);
  });

  it('A, B without enable, A: the running Runtime is the same content, so 200', async () => {
    const w = await world();
    const first = await json(await send(w));
    expect((await send(w, simple('2026-11-10T08:00'), '')).status).toBe(200);
    const r = await send(w);
    expect(r.status).toBe(200);
    const b = await json(r);
    expect(b.runtimeSchedule.id).toBe(first.runtimeSchedule.id);
    expect(b.masterSchedule.revision).toBe(3);
    expect(await liveCount()).toBe(1);
  });

  it('live, edited in Commander, then the running content re-sent: 200, and no replace is needed', async () => {
    const w = await world();
    const first = await json(await send(w));
    await editInCommander(w, first.masterSchedule.id, simple('2026-11-10T09:00'));
    const r = await send(w);
    expect(r.status).toBe(200);
    expect((await json(r)).runtimeSchedule.id).toBe(first.runtimeSchedule.id);
  });

  it('cancelled, then edited in Commander, then the unchanged body re-sent: not revived', async () => {
    const w = await world();
    const first = await json(await send(w));
    await cancelViaApi(w, first.runtimeSchedule.id);
    await editInCommander(w, first.masterSchedule.id, simple('2026-11-10T09:00', { name: 'Edited' }));
    const r = await send(w);
    expect(r.status).toBe(200);
    const b = await json(r);
    expect(b.enabled).toBe(false);
    expect(b.runtimeSchedule).toMatchObject({ id: first.runtimeSchedule.id, status: 'cancelled' });
    expect(b.masterSchedule.revision).toBe(3);
    expect(await liveCount()).toBe(0);
  });

  it('delete the Master while it runs, re-send the same: no second live Runtime', async () => {
    const w = await world();
    const first = await json(await send(w));
    expect((await del(w, first.masterSchedule.id)).status).toBe(204);
    const r = await send(w);
    expect(r.status).toBe(200);
    const b = await json(r);
    expect(b.masterSchedule.id).not.toBe(first.masterSchedule.id);
    expect(b.masterSchedule.revision).toBe(1);
    expect(b.runtimeSchedule.id).toBe(first.runtimeSchedule.id);
    expect(b.enabled).toBeUndefined();
    expect(await liveCount()).toBe(1);

    // Enable on request still refuses while the key's Runtime is on.
    const on = await call(w.token, 'POST', `/work-centers/${w.wc}/master-schedules/${b.masterSchedule.id}/enable`);
    expect(on.status).toBe(409);
    expect((await json(on)).error.code).toBe('RUNTIME_ACTIVE');
    expect(await liveCount()).toBe(1);
  });

  it('delete the Master while it runs, re-send different: 409 every time, until replaceActive', async () => {
    const w = await world();
    const first = await json(await send(w));
    await del(w, first.masterSchedule.id);
    for (let i = 0; i < 2; i++) {
      const r = await send(w, simple('2026-11-10T08:00'));
      expect(r.status).toBe(409);
      expect((await json(r)).error.code).toBe('RUNTIME_ACTIVE');
    }
    const r = await send(w, simple('2026-11-10T08:00'), '?enable=true&replaceActive=true');
    expect(r.status).toBe(201);
    const b = await json(r);
    expect(b.replacedRuntimeSchedule).toMatchObject({ id: first.runtimeSchedule.id, status: 'cancelled' });
    expect(b.runtimeSchedule.label).toBe('RS-2');
    expect(await liveCount()).toBe(1);
  });

  it('ended, Master deleted and recreated: the same body is not revived, a different one is new work', async () => {
    const w = await world();
    const first = await json(await send(w));
    await cancelViaApi(w, first.runtimeSchedule.id);
    await del(w, first.masterSchedule.id);
    const same = await send(w);
    expect(same.status).toBe(200);
    const b = await json(same);
    expect(b.enabled).toBe(false);
    expect(b.runtimeSchedule.id).toBe(first.runtimeSchedule.id);
    expect(await liveCount()).toBe(0);

    const different = await send(w, simple('2026-11-10T08:00'));
    expect(different.status).toBe(201);
    expect((await json(different)).runtimeSchedule.label).toBe('RS-2');
  });

  it('POST enable still starts one that a re-send will not', async () => {
    const w = await world();
    const first = await json(await send(w));
    await cancelViaApi(w, first.runtimeSchedule.id);
    expect((await json(await send(w))).enabled).toBe(false);
    const on = await call(w.token, 'POST', `/work-centers/${w.wc}/master-schedules/${first.masterSchedule.id}/enable`);
    expect(on.status).toBe(201);
    expect((await send(w)).status).toBe(200);
    expect(await liveCount()).toBe(1);
  });

  it('the same key in another work center is another schedule', async () => {
    const w = await world();
    const { token } = await w.client(ALL, [w.wc, w.other], 'Both');
    const here = await json(await send(w));
    await cancelViaApi(w, here.runtimeSchedule.id);
    const there = await call(token, 'PUT', `/work-centers/${w.other}/master-schedules/by-key/PO-1?enable=true`, simple());
    expect(there.status).toBe(201);
  });
});

describe('acknowledge stays within its Runtime', () => {
  it('a run id from another Runtime changes nothing and counts 0', async () => {
    const w = await world();
    const a = await json(await send(w));
    const b = await json(await send(w, simple('2026-11-10T06:00', { name: 'Other' }), '?enable=true', 'PO-2'));
    const { run } = await seedRun(b.runtimeSchedule.id, 'failed_to_start', { detail: 'boom' });
    const r = await call(w.token, 'POST', `/work-centers/${w.wc}/runtime-schedules/${a.runtimeSchedule.id}/acknowledge`, { runIds: [run.id] });
    expect(r.status).toBe(200);
    expect(await json(r)).toEqual({ dismissed: 0 });
    const [still] = await db.select().from(scheduleItemRun).where(eq(scheduleItemRun.id, run.id));
    expect(still!.acknowledgedAt).toBeNull();
  });
});
