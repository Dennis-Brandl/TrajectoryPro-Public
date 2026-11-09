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
import { Hono, type Context } from 'hono';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../lib/db';
import { appUser, masterSchedule, runtimeSchedule, runtimeScheduleItem, RUNTIME_SCHEDULE_STATUSES } from 'mission-control-db/src/db/schema/index';
import { workCenterExists } from 'mission-control-db/src/dao/shared-state';
import {
  createMasterSchedule, replaceMasterSchedule, deleteMasterSchedule, getMasterSchedule, listMasterSchedules,
  listMasterScheduleChanges,
} from 'mission-control-db/src/scheduling/master-dao';
import { workCenter } from 'mission-control-db/src/db/schema/index';
import { enableMasterSchedule, previewEnable, previewRunOnce, runMasterScheduleOnce } from 'mission-control-db/src/scheduling/enable';
import { listScheduleWorkflowOptions } from 'mission-control-db/src/scheduling/workflow-options';
import {
  listRuntimeSchedules, getRuntimeSchedule, listOccurrences, listRuntimeScheduleEvents, effectiveTimeZone, scheduleClock,
} from 'mission-control-db/src/scheduling/runtime-dao';
import {
  getResumePreview, pauseRuntimeSchedule, resumeRuntimeSchedule, cancelRuntimeSchedule, removeRuntimeSchedule,
  setRuntimeItemDisabled, acknowledgeRuntimeItems,
} from 'mission-control-db/src/scheduling/controls';
import { parseRecurrence, nextOccurrence, describeRecurrence, isLocalDateTime } from 'mission-control-db/src/scheduling/recurrence';
import type { ScheduleActor } from 'mission-control-db/src/scheduling/events';
import { requireSession, requirePermission, requireMissionSystemCommander, type Vars } from '../middleware/auth';
import { requireUuidParams } from '../middleware/validate';
import { httpError, sendError } from '../lib/errors';
import { readJsonObject } from '../lib/json-body';

// Spec 2026-11-08 §7.1: the rule that governs manual Start governs schedules. Reads are open
// (work_center:read, which every tier holds); every write needs the Mission System Commander
// flag on the schedule's work center, or Administrator.
export const scheduleRoutes = new Hono<{ Variables: Vars }>();
scheduleRoutes.use('/work-centers/:id/master-schedules', requireSession);
scheduleRoutes.use('/work-centers/:id/recurrence-preview', requireSession);
scheduleRoutes.use('/work-centers/:id/schedule-clock', requireSession);
scheduleRoutes.use('/work-centers/:id/schedule-workflows', requireSession);
scheduleRoutes.use('/work-centers/:id/runtime-schedules', requireSession);
scheduleRoutes.use('/master-schedules/*', requireSession);
scheduleRoutes.use('/runtime-schedules/*', requireSession);

type Ctx = Context<{ Variables: Vars }>;

const OCCURRENCE_DEFAULT_LIMIT = 25;
const OCCURRENCE_MAX_LIMIT = 100;
const PREVIEW_TIMES = 5;

// ---------------------------------------------------------------------------------- resolvers
// Each returns the work center the subject belongs to, or null when the subject does not exist
// (requireMissionSystemCommander then answers 404).

const wcExists = async (id: string) => ((await workCenterExists(db, id)) ? id : null);

async function wcOfMaster(id: string): Promise<string | null> {
  const [row] = await db.select({ wc: masterSchedule.workCenterId }).from(masterSchedule).where(eq(masterSchedule.id, id));
  return row?.wc ?? null;
}

async function wcOfRuntime(id: string): Promise<string | null> {
  const [row] = await db.select({ wc: runtimeSchedule.workCenterId }).from(runtimeSchedule).where(eq(runtimeSchedule.id, id));
  return row?.wc ?? null;
}

/** The item must belong to the Runtime in the path, else it is a different resource: 404. */
async function wcOfItem(id: string, itemId: string): Promise<string | null> {
  const [row] = await db.select({ wc: runtimeSchedule.workCenterId }).from(runtimeScheduleItem)
    .innerJoin(runtimeSchedule, eq(runtimeSchedule.id, runtimeScheduleItem.runtimeScheduleId))
    .where(and(eq(runtimeScheduleItem.id, itemId), eq(runtimeScheduleItem.runtimeScheduleId, id)));
  return row?.wc ?? null;
}

/** Who did it, for the schedule's event log. Name: the sign-in name, else the display name. */
async function actorOf(c: Ctx): Promise<ScheduleActor> {
  const userId = c.get('principal').userId;
  const [u] = await db.select({ loginName: appUser.loginName, displayName: appUser.displayName })
    .from(appUser).where(eq(appUser.id, userId));
  return { kind: 'user', userId, name: u?.loginName || u?.displayName || userId };
}

// The ids in these paths are mandatory in the pattern; the resolver's Context type cannot carry the
// literal param key, so c.req.param() is `string | undefined` there (see runtime-workflows.ts).
const commanderOfWorkCenter = requireMissionSystemCommander((c) => wcExists(c.req.param('id')!));
const commanderOfMaster = requireMissionSystemCommander((c) => wcOfMaster(c.req.param('id')!));
const commanderOfRuntime = requireMissionSystemCommander((c) => wcOfRuntime(c.req.param('id')!));
const commanderOfItem = requireMissionSystemCommander((c) => wcOfItem(c.req.param('id')!, c.req.param('itemId')!));

const readGate = requirePermission('work_center:read');

// ------------------------------------------------------------------------------ master schedules

scheduleRoutes.get('/work-centers/:id/master-schedules', requireUuidParams('id'), readGate, async (c) => {
  const id = c.req.param('id');
  if (!(await workCenterExists(db, id))) return httpError(c, 404, 'not_found', 'Work center not found');
  return c.json(await listMasterSchedules(db, id));
});

// What the editor's workflow and value pickers offer: every workflow of the work center, with its
// starting parameters and output ids (spec §5.6).
scheduleRoutes.get('/work-centers/:id/schedule-workflows', requireUuidParams('id'), readGate, async (c) => {
  const id = c.req.param('id');
  if (!(await workCenterExists(db, id))) return httpError(c, 404, 'not_found', 'Work center not found');
  const rows = await listScheduleWorkflowOptions(db, id);
  return c.json(rows.map((r) => ({
    ...r,
    startingParameters: r.startingParameters.map((p) => ({
      id: p.id, description: p.description, defaultValue: p.default_value, valueType: p.value_type,
    })),
  })));
});

scheduleRoutes.get('/master-schedules/:id', requireUuidParams('id'), readGate, async (c) => {
  const master = await getMasterSchedule(db, c.req.param('id'));
  if (!master) return httpError(c, 404, 'not_found', 'Master Schedule not found');
  return c.json(master);
});

/** The body is a schedule definition plus `changeReason`, which goes to the change history. */
function splitReason(body: Record<string, unknown>): { definition: Record<string, unknown>; reason: unknown } {
  const { changeReason, ...definition } = body;
  return { definition, reason: changeReason };
}

// The definition's tree is validated by parseScheduleDefinition inside the DAO, so this route and
// the REST API agree on what is valid. A new Master's reason is optional ("Initial version" when left out).
scheduleRoutes.post('/work-centers/:id/master-schedules', requireUuidParams('id'), commanderOfWorkCenter, async (c) => {
  const body = await readJsonObject(c);
  if (!body) return httpError(c, 400, 'bad_request', 'Request body must be a JSON object');
  const { definition, reason } = splitReason(body);
  if (reason !== undefined && typeof reason !== 'string') return httpError(c, 400, 'validation', 'changeReason must be text');
  try {
    return c.json(await createMasterSchedule(db, c.req.param('id'), definition, await actorOf(c), reason ?? 'Initial version'), 201);
  } catch (err) { return sendError(c, err, 'Saving the Master Schedule failed'); }
});

// Every edit needs a reason. An unchanged body saves nothing and records nothing.
scheduleRoutes.put('/master-schedules/:id', requireUuidParams('id'), commanderOfMaster, async (c) => {
  const body = await readJsonObject(c);
  if (!body) return httpError(c, 400, 'bad_request', 'Request body must be a JSON object');
  const { definition, reason } = splitReason(body);
  if (typeof reason !== 'string' || reason.trim() === '') return httpError(c, 400, 'validation', 'A reason for the change (changeReason) is required');
  try {
    return c.json(await replaceMasterSchedule(db, c.req.param('id'), definition, await actorOf(c), reason));
  } catch (err) { return sendError(c, err, 'Saving the Master Schedule failed'); }
});

// What the Export PDF needs: the Master, its work center and zone, and every saved version.
scheduleRoutes.get('/master-schedules/:id/record', requireUuidParams('id'), readGate, async (c) => {
  const master = await getMasterSchedule(db, c.req.param('id'));
  if (!master) return httpError(c, 404, 'not_found', 'Master Schedule not found');
  const [wc] = await db.select({ name: workCenter.name }).from(workCenter).where(eq(workCenter.id, master.workCenterId));
  return c.json({
    master, workCenterName: wc?.name ?? '', timeZone: await effectiveTimeZone(db, master.workCenterId),
    changes: await listMasterScheduleChanges(db, master.id),
  });
});

scheduleRoutes.delete('/master-schedules/:id', requireUuidParams('id'), commanderOfMaster, async (c) => {
  try {
    await deleteMasterSchedule(db, c.req.param('id'), await actorOf(c));
    return c.body(null, 204);
  } catch (err) { return sendError(c, err, 'Deleting the Master Schedule failed'); }
});

const previewBody = z.object({ recurrence: z.unknown() }).strict();

scheduleRoutes.post('/work-centers/:id/recurrence-preview', requireUuidParams('id'), readGate, async (c) => {
  const parsed = previewBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return httpError(c, 400, 'validation', 'Body must be { recurrence }');
  const recurrence = parseRecurrence(parsed.data.recurrence);
  if (!recurrence.ok) return httpError(c, 400, 'validation', recurrence.problems.join('; '));
  const id = c.req.param('id');
  if (!(await workCenterExists(db, id))) return httpError(c, 404, 'not_found', 'Work center not found');
  const timeZone = await effectiveTimeZone(db, id);
  const nextFireTimes: Date[] = [];
  let after = new Date();
  while (nextFireTimes.length < PREVIEW_TIMES) {
    const slot = nextOccurrence(recurrence.value, timeZone, after);
    if (!slot) break;
    nextFireTimes.push(slot.at);
    after = slot.at;
  }
  return c.json({ nextFireTimes, recurrenceText: describeRecurrence(recurrence.value), timeZone });
});

// The zone schedule times are read in, for the editor's and Run Once dialog's note.
scheduleRoutes.get('/work-centers/:id/schedule-clock', requireUuidParams('id'), readGate, async (c) => {
  const id = c.req.param('id');
  if (!(await workCenterExists(db, id))) return httpError(c, 404, 'not_found', 'Work center not found');
  return c.json(await scheduleClock(db, id));
});

scheduleRoutes.get('/master-schedules/:id/enable-preview', requireUuidParams('id'), readGate, async (c) => {
  try { return c.json(await previewEnable(db, c.req.param('id'), new Date())); }
  catch (err) { return sendError(c, err, 'Previewing Enable failed'); }
});

// A 422 carries the problems in `details`; a Master already on is 409.
scheduleRoutes.post('/master-schedules/:id/enable', requireUuidParams('id'), commanderOfMaster, async (c) => {
  try {
    return c.json(await enableMasterSchedule(db, c.req.param('id'), await actorOf(c), new Date()), 201);
  } catch (err) { return sendError(c, err, 'Enable failed'); }
});

scheduleRoutes.get('/master-schedules/:id/run-once-preview', requireUuidParams('id'), readGate, async (c) => {
  try { return c.json(await previewRunOnce(db, c.req.param('id'), new Date())); }
  catch (err) { return sendError(c, err, 'Previewing Run Once failed'); }
});

const runOnceBody = z.object({ at: z.string().refine(isLocalDateTime).optional() }).strict();

// With no `at` it starts now; with one, at that local time in the work center's zone. A 422 carries the problems.
scheduleRoutes.post('/master-schedules/:id/run-once', requireUuidParams('id'), commanderOfMaster, async (c) => {
  const parsed = runOnceBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return httpError(c, 400, 'validation', 'Body must be { at?: "YYYY-MM-DDTHH:mm" }');
  try {
    return c.json(await runMasterScheduleOnce(db, c.req.param('id'), await actorOf(c), new Date(), parsed.data.at), 201);
  } catch (err) { return sendError(c, err, 'Run Once failed'); }
});

// ------------------------------------------------------------------------------ runtime schedules

const statusQuery = z.object({ status: z.enum(RUNTIME_SCHEDULE_STATUSES).optional() }).strict();

scheduleRoutes.get('/work-centers/:id/runtime-schedules', requireUuidParams('id'), readGate, async (c) => {
  const parsed = statusQuery.safeParse(c.req.query());
  if (!parsed.success) return httpError(c, 400, 'validation', 'status must be active, paused, cancelled or finished');
  const id = c.req.param('id');
  if (!(await workCenterExists(db, id))) return httpError(c, 404, 'not_found', 'Work center not found');
  return c.json(await listRuntimeSchedules(db, id, parsed.data.status));
});

scheduleRoutes.get('/runtime-schedules/:id', requireUuidParams('id'), readGate, async (c) => {
  const detail = await getRuntimeSchedule(db, c.req.param('id'));
  if (!detail) return httpError(c, 404, 'not_found', 'Runtime Schedule not found');
  return c.json(detail);
});

const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(OCCURRENCE_MAX_LIMIT).default(OCCURRENCE_DEFAULT_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
}).strict();

scheduleRoutes.get('/runtime-schedules/:id/occurrences', requireUuidParams('id'), readGate, async (c) => {
  const parsed = pageQuery.safeParse(c.req.query());
  if (!parsed.success) return httpError(c, 400, 'validation', `limit is 1 to ${OCCURRENCE_MAX_LIMIT}; offset is 0 or more`);
  const id = c.req.param('id');
  const [exists] = await db.select({ id: runtimeSchedule.id }).from(runtimeSchedule).where(eq(runtimeSchedule.id, id));
  if (!exists) return httpError(c, 404, 'not_found', 'Runtime Schedule not found');
  return c.json(await listOccurrences(db, id, parsed.data));
});

// The audit log: newest first, read like the occurrences (work_center:read).
scheduleRoutes.get('/runtime-schedules/:id/events', requireUuidParams('id'), readGate, async (c) => {
  const parsed = pageQuery.safeParse(c.req.query());
  if (!parsed.success) return httpError(c, 400, 'validation', `limit is 1 to ${OCCURRENCE_MAX_LIMIT}; offset is 0 or more`);
  const id = c.req.param('id');
  const [exists] = await db.select({ id: runtimeSchedule.id }).from(runtimeSchedule).where(eq(runtimeSchedule.id, id));
  if (!exists) return httpError(c, 404, 'not_found', 'Runtime Schedule not found');
  return c.json(await listRuntimeScheduleEvents(db, id, parsed.data));
});

scheduleRoutes.get('/runtime-schedules/:id/resume-preview', requireUuidParams('id'), readGate, async (c) => {
  try { return c.json(await getResumePreview(db, c.req.param('id'), new Date())); }
  catch (err) { return sendError(c, err, 'Resume preview failed'); }
});

// Bodies are strict envelopes. Pause takes none; an absent or empty body is fine.
const pauseBody = z.object({}).strict();
const resumeBody = z.object({
  missed: z.enum(['all', 'latest', 'skip']).optional(),
  heldChains: z.union([
    z.enum(['start', 'skip']),
    z.object({ start: z.array(z.string().uuid()), skip: z.array(z.string().uuid()) }).strict(),
  ]).optional(),
  expectedMissedCount: z.number().int().min(0).optional(),
}).strict();
const cancelBody = z.object({ reason: z.string().max(2000) }).strict();
const acknowledgeBody = z.object({ runIds: z.union([z.literal('all'), z.array(z.string().uuid())]) }).strict();
const disabledBody = z.object({ disabled: z.boolean() }).strict();

/** An absent or malformed body reads as `{}`, so the strict parse decides whether that is allowed. */
const optionalBody = (c: Ctx) => c.req.json().catch(() => ({}));

scheduleRoutes.post('/runtime-schedules/:id/pause', requireUuidParams('id'), commanderOfRuntime, async (c) => {
  if (!pauseBody.safeParse(await optionalBody(c)).success) return httpError(c, 400, 'validation', 'Pause takes no body');
  try {
    await pauseRuntimeSchedule(db, c.req.param('id'), await actorOf(c), new Date());
    return c.body(null, 204);
  } catch (err) { return sendError(c, err, 'Pause failed'); }
});

scheduleRoutes.post('/runtime-schedules/:id/resume', requireUuidParams('id'), commanderOfRuntime, async (c) => {
  const parsed = resumeBody.safeParse(await optionalBody(c));
  if (!parsed.success) return httpError(c, 400, 'validation', 'Body must be { missed?, heldChains?, expectedMissedCount? }');
  try {
    return c.json(await resumeRuntimeSchedule(db, c.req.param('id'), parsed.data, await actorOf(c), new Date()));
  } catch (err) { return sendError(c, err, 'Resume failed'); }
});

scheduleRoutes.post('/runtime-schedules/:id/cancel', requireUuidParams('id'), commanderOfRuntime, async (c) => {
  const parsed = cancelBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success || parsed.data.reason.trim() === '') {
    return httpError(c, 400, 'validation', 'Cancel needs a reason');
  }
  try {
    await cancelRuntimeSchedule(db, c.req.param('id'), parsed.data.reason, await actorOf(c), new Date());
    return c.body(null, 204);
  } catch (err) { return sendError(c, err, 'Cancel failed'); }
});

scheduleRoutes.post('/runtime-schedules/:id/remove', requireUuidParams('id'), commanderOfRuntime, async (c) => {
  try {
    await removeRuntimeSchedule(db, c.req.param('id'), await actorOf(c), new Date());
    return c.body(null, 204);
  } catch (err) { return sendError(c, err, 'Remove failed'); }
});

scheduleRoutes.post('/runtime-schedules/:id/acknowledge', requireUuidParams('id'), commanderOfRuntime, async (c) => {
  const parsed = acknowledgeBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return httpError(c, 400, 'validation', "Body must be { runIds: string[] | 'all' }");
  try {
    const dismissed = await acknowledgeRuntimeItems(db, c.req.param('id'), parsed.data.runIds, await actorOf(c), new Date());
    return c.json({ dismissed });
  } catch (err) { return sendError(c, err, 'Dismiss failed'); }
});

scheduleRoutes.put('/runtime-schedules/:id/items/:itemId/disabled', requireUuidParams('id', 'itemId'), commanderOfItem, async (c) => {
  const parsed = disabledBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return httpError(c, 400, 'validation', 'Body must be { disabled: boolean }');
  try {
    await setRuntimeItemDisabled(db, c.req.param('itemId'), parsed.data.disabled, await actorOf(c), new Date());
    return c.body(null, 204);
  } catch (err) { return sendError(c, err, 'Changing the item failed'); }
});
