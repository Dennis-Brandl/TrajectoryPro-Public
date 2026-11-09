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
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../lib/db';
import { errorBody, daoErrorStatus, httpError } from '../../lib/errors';
import { isUuid } from '../../middleware/validate';
import { notFound, requireApiClient, requireClientScope, type ApiClientVars } from '../../middleware/api-client';
import { DaoError } from 'mission-control-db/src/dao/errors';
import {
  masterSchedule, runtimeSchedule, runtimeScheduleItem, workCenter, RUNTIME_SCHEDULE_STATUSES,
} from 'mission-control-db/src/db/schema/index';
import { deleteMasterSchedule, getMasterSchedule, listMasterSchedules, type MasterScheduleView } from 'mission-control-db/src/scheduling/master-dao';
import { enableMasterSchedule, runMasterScheduleOnce } from 'mission-control-db/src/scheduling/enable';
import { LONE_SURROGATE } from 'mission-control-db/src/scheduling/definition';
import { isLocalDateTime } from 'mission-control-db/src/scheduling/recurrence';
import { listOccurrencesWithEndings, sendMasterSchedule } from 'mission-control-db/src/scheduling/external';
import { listScheduleWorkflowOptions } from 'mission-control-db/src/scheduling/workflow-options';
import {
  effectiveTimeZone, getRuntimeSchedule, listRuntimeSchedules, type RuntimeScheduleView,
} from 'mission-control-db/src/scheduling/runtime-dao';
import {
  acknowledgeRuntimeItems, cancelRuntimeSchedule, getResumePreview, pauseRuntimeSchedule,
  resumeRuntimeSchedule, setRuntimeItemDisabled,
} from 'mission-control-db/src/scheduling/controls';
import type { ScheduleActor } from 'mission-control-db/src/scheduling/events';

// The REST interface a higher-level scheduling system uses (spec 2026-11-08 §8). Docs for its
// users: docs/external-api.md. Authentication is the bearer token only; nothing here reads a session.
type SendOptions = { enable: boolean; replaceActive: boolean };
type Vars = ApiClientVars & { sendOptions: SendOptions };
export const externalRoutes = new Hono<{ Variables: Vars }>();
type Ctx = Context<{ Variables: Vars }>;
type Guard = MiddlewareHandler<{ Variables: Vars }>;

const MAX_BODY_BYTES = 1024 * 1024;
const OCCURRENCE_DEFAULT_LIMIT = 25;
const OCCURRENCE_MAX_LIMIT = 100;
/** A key is the sender's own reference: any text a path can carry, without control characters. */
const EXTERNAL_KEY = /^\P{Cc}{1,200}$/u;

externalRoutes.use('*', requireApiClient);
externalRoutes.use('*', bodyLimit({
  maxSize: MAX_BODY_BYTES,
  onError: (c) => httpError(c, 413, 'too_large', 'The request body is over the 1 MB limit'),
}));

// §8: errors name the DAO's own code. A 404 always has the one body, so nothing can be told apart.
externalRoutes.onError((err, c) => {
  if (err instanceof DaoError) {
    const status = daoErrorStatus(err.code);
    if (status === 404) return notFound(c);
    return c.json(errorBody(err.code, messageOf(err), err.details), status as ContentfulStatusCode);
  }
  console.error(`[external] ${c.req.method} ${c.req.path}:`, err);
  return httpError(c, 500, 'internal', 'Internal error');
});

function messageOf(err: DaoError): string {
  if (err.code !== 'ENABLE_INVALID' || !Array.isArray(err.details)) return err.message;
  const n = err.details.length;
  return n === 1
    ? '1 problem prevents this schedule from being enabled'
    : `${n} problems prevent this schedule from being enabled`;
}

const read = requireClientScope('schedules:read');
const write = requireClientScope('schedules:write');
const control = requireClientScope('schedules:control');

const actorOf = (c: Ctx): ScheduleActor => {
  const client = c.get('apiClient');
  return { kind: 'api_client', clientId: client.id, name: client.name };
};

// -------------------------------------------------------------------------------------- wire format

/** §8.4: instants go out in UTC to the second, `2026-11-10T12:00:00Z`, everywhere. */
function wire(value: unknown): unknown {
  if (value instanceof Date) return `${value.toISOString().slice(0, 19)}Z`;
  if (Array.isArray(value)) return value.map(wire);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, wire(v)]));
  }
  return value;
}
const send = (c: Ctx, value: unknown, status: ContentfulStatusCode = 200) => c.json(wire(value) as object, status);

const masterSummary = (m: MasterScheduleView) => ({ id: m.id, externalKey: m.externalKey, revision: m.revision, source: m.source });
const runtimeSummary = (r: RuntimeScheduleView, warnings: string[]) => ({
  id: r.id, label: r.label, status: r.status, nextFireAt: r.nextFireAt, timeZone: r.timeZone, warnings,
});

// ------------------------------------------------------------------------------------------- bodies

/** The parsed body, `undefined` when there is none, `null` when it is not JSON. */
async function readBody(c: Ctx): Promise<unknown> {
  const text = await c.req.text();
  if (text.trim() === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** For a control whose body is optional: none reads as `{}`, so the strict parse decides. */
const optionalBody = async (c: Ctx) => {
  const body = await readBody(c);
  return body === undefined ? {} : body;
};

const invalid = (c: Ctx, message: string) => httpError(c, 400, 'validation', message);

// ------------------------------------------------------------------------------------- path guards

const param = (c: Ctx, name: string) => c.req.param(name) ?? '';

/** The Master in the path must belong to `:wc`. Anything else is the same 404 as one that does not exist. */
const ownMaster: Guard = async (c, next) => {
  const id = param(c, 'id');
  if (!isUuid(id)) return notFound(c);
  const [row] = await db.select({ id: masterSchedule.id }).from(masterSchedule)
    .where(and(eq(masterSchedule.id, id), eq(masterSchedule.workCenterId, param(c, 'wc'))));
  if (!row) return notFound(c);
  await next();
};

const ownRuntime: Guard = async (c, next) => {
  const id = param(c, 'id');
  if (!isUuid(id)) return notFound(c);
  const [row] = await db.select({ id: runtimeSchedule.id }).from(runtimeSchedule)
    .where(and(eq(runtimeSchedule.id, id), eq(runtimeSchedule.workCenterId, param(c, 'wc'))));
  if (!row) return notFound(c);
  await next();
};

/** Runs after ownRuntime: the item must belong to that Runtime. */
const ownItem: Guard = async (c, next) => {
  const itemId = param(c, 'itemId');
  if (!isUuid(itemId)) return notFound(c);
  const [row] = await db.select({ id: runtimeScheduleItem.id }).from(runtimeScheduleItem)
    .where(and(eq(runtimeScheduleItem.id, itemId), eq(runtimeScheduleItem.runtimeScheduleId, param(c, 'id'))));
  if (!row) return notFound(c);
  await next();
};

// -------------------------------------------------------------------------------------- work centers

externalRoutes.get('/work-centers', requireClientScope('schedules:read', { workCenter: false }), async (c) => {
  const ids = c.get('apiClient').workCenterIds;
  if (ids.length === 0) return send(c, []);
  const rows = await db.select({ id: workCenter.id, name: workCenter.name }).from(workCenter)
    .where(inArray(workCenter.id, ids)).orderBy(workCenter.name);
  return send(c, await Promise.all(rows.map(async (r) => ({ ...r, timeZone: await effectiveTimeZone(db, r.id) }))));
});

externalRoutes.get('/work-centers/:wc/workflows', read, async (c) => {
  const rows = await listScheduleWorkflowOptions(db, c.req.param('wc'));
  return send(c, rows.map((r) => ({
    name: r.name, version: r.version, state: r.state,
    startingParameters: r.startingParameters.map((p) => ({
      id: p.id, description: p.description, defaultValue: p.default_value, valueType: p.value_type,
    })),
    outputs: r.outputs,
  })));
});

// ---------------------------------------------------------------------------------- master schedules

externalRoutes.get('/work-centers/:wc/master-schedules', read, async (c) => {
  const wc = c.req.param('wc');
  const timeZone = await effectiveTimeZone(db, wc);
  return send(c, (await listMasterSchedules(db, wc)).map((m) => ({ ...m, timeZone })));
});

const SEND_QUERY_KEYS = ['enable', 'replaceActive'];
const FLAG = ['true', 'false'];

/**
 * The one reading of a send's query. Hono's `query(name)` and `query()` differ on an encoded key and
 * on a repeated one, so neither is used: the URL's own decoding gives every pair, and this decides
 * from all of them. Any pair asking for true needs the control scope, whichever other pairs came with
 * it, and that comes first so the answer to a client without it never depends on the rest. Only then
 * is a repeated key, an unknown key or an unknown value refused.
 */
const readSendQuery: Guard = async (c, next) => {
  const pairs = [...new URL(c.req.url).searchParams.entries()];
  if (pairs.some(([k, v]) => SEND_QUERY_KEYS.includes(k) && v === 'true')) {
    let passed = false;
    // Vars only adds to what the guard reads, but Hono's Context type is invariant in it.
    const refused = await (control as unknown as Guard)(c, async () => { passed = true; });
    if (!passed) return refused as Response;
  }
  const keys = pairs.map(([k]) => k);
  if (new Set(keys).size !== keys.length || pairs.some(([k, v]) => !SEND_QUERY_KEYS.includes(k) || !FLAG.includes(v))) {
    return invalid(c, 'The query takes enable and replaceActive, each once, each true or false');
  }
  const asked = new Map(pairs);
  const options = { enable: asked.get('enable') === 'true', replaceActive: asked.get('replaceActive') === 'true' };
  if (options.replaceActive && !options.enable) return invalid(c, 'replaceActive=true needs enable=true');
  c.set('sendOptions', options);
  await next();
};

externalRoutes.put('/work-centers/:wc/master-schedules/by-key/:key', write, readSendQuery, async (c) => {
  const options = c.get('sendOptions');
  const key = c.req.param('key');
  if (!EXTERNAL_KEY.test(key)) return invalid(c, 'The key is 1 to 200 characters, with no control characters');

  const body = await readBody(c);
  const r = await sendMasterSchedule(db, c.req.param('wc'), key, body ?? null, options, actorOf(c), new Date());
  const response: Record<string, unknown> = { masterSchedule: masterSummary(r.master) };
  if (r.runtime) response.runtimeSchedule = runtimeSummary(r.runtime, r.warnings);
  if (r.outcome === 'already_ended') response.enabled = false;
  if (r.replaced) response.replacedRuntimeSchedule = r.replaced;
  return send(c, response, r.outcome === 'enabled' || (r.outcome === 'saved' && r.created) ? 201 : 200);
});

externalRoutes.get('/work-centers/:wc/master-schedules/:id', read, ownMaster, async (c) => {
  const master = await getMasterSchedule(db, c.req.param('id'));
  if (!master) return notFound(c);
  return send(c, { ...master, timeZone: await effectiveTimeZone(db, c.req.param('wc')) });
});

externalRoutes.delete('/work-centers/:wc/master-schedules/:id', write, ownMaster, async (c) => {
  await deleteMasterSchedule(db, c.req.param('id'), actorOf(c));
  return c.body(null, 204);
});

externalRoutes.post('/work-centers/:wc/master-schedules/:id/enable', control, ownMaster, async (c) => {
  const { runtime, warnings, master } = await enableMasterSchedule(db, c.req.param('id'), actorOf(c), new Date());
  return send(c, { masterSchedule: masterSummary(master), runtimeSchedule: runtimeSummary(runtime, warnings) }, 201);
});

/** `at` is local to the work center; `requestId` makes a retry safe, so an alarm system cannot start two responses by retrying. */
const runOnceBody = z.object({
  at: z.string().refine(isLocalDateTime).optional(),
  requestId: z.string().refine((s) => EXTERNAL_KEY.test(s) && !LONE_SURROGATE.test(s)).optional(),
}).strict();

externalRoutes.post('/work-centers/:wc/master-schedules/:id/run-once', control, ownMaster, async (c) => {
  const parsed = runOnceBody.safeParse(await optionalBody(c));
  if (!parsed.success) return invalid(c, 'Body must be { at?: "YYYY-MM-DDTHH:mm", requestId?: 1 to 200 characters }');
  try {
    const { runtime, warnings, master, repeated } = await runMasterScheduleOnce(
      db, c.req.param('id'), actorOf(c), new Date(), parsed.data.at, parsed.data.requestId,
    );
    return send(c, { masterSchedule: masterSummary(master), runtimeSchedule: runtimeSummary(runtime, warnings), repeated }, repeated ? 200 : 201);
  } catch (err) {
    if (!(err instanceof DaoError) || err.code !== 'ENABLE_INVALID' || !Array.isArray(err.details)) throw err;
    const n = err.details.length;
    return c.json(errorBody(err.code, `${n} ${n === 1 ? 'problem prevents' : 'problems prevent'} this schedule from starting`, err.details), 422);
  }
});

// --------------------------------------------------------------------------------- runtime schedules

const statusQuery = z.object({ status: z.enum(RUNTIME_SCHEDULE_STATUSES).optional() }).strict();

externalRoutes.get('/work-centers/:wc/runtime-schedules', read, async (c) => {
  const parsed = statusQuery.safeParse(c.req.query());
  if (!parsed.success) return invalid(c, 'status must be active, paused, cancelled or finished');
  return send(c, await listRuntimeSchedules(db, c.req.param('wc'), parsed.data.status));
});

// missedCount and missedMore are what a caller passes back as Resume's expectedMissedCount.
externalRoutes.get('/work-centers/:wc/runtime-schedules/:id', read, ownRuntime, async (c) => {
  const id = c.req.param('id');
  const detail = await getRuntimeSchedule(db, id);
  if (!detail) return notFound(c);
  const live = detail.status === 'active' || detail.status === 'paused';
  const preview = live ? await getResumePreview(db, id, new Date()) : null;
  return send(c, { ...detail, missedCount: preview?.missedCount ?? 0, missedMore: preview?.missedMore ?? false });
});

const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(OCCURRENCE_MAX_LIMIT).default(OCCURRENCE_DEFAULT_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
}).strict();

externalRoutes.get('/work-centers/:wc/runtime-schedules/:id/occurrences', read, ownRuntime, async (c) => {
  const parsed = pageQuery.safeParse(c.req.query());
  if (!parsed.success) return invalid(c, `limit is 1 to ${OCCURRENCE_MAX_LIMIT}; offset is 0 or more`);
  const page = await listOccurrencesWithEndings(db, c.req.param('id'), parsed.data);
  return send(c, { ...page, ...parsed.data, timeZone: await effectiveTimeZone(db, c.req.param('wc')) });
});

const pauseBody = z.object({}).strict();
const resumeBody = z.object({
  missed: z.enum(['all', 'latest', 'skip']).optional(),
  heldChains: z.enum(['start', 'skip']).optional(),
  expectedMissedCount: z.number().int().min(0).optional(),
}).strict();
const cancelBody = z.object({ reason: z.string().max(2000) }).strict();
const acknowledgeBody = z.object({ runIds: z.union([z.literal('all'), z.array(z.string().uuid())]) }).strict();
const disabledBody = z.object({ disabled: z.boolean() }).strict();

externalRoutes.post('/work-centers/:wc/runtime-schedules/:id/pause', control, ownRuntime, async (c) => {
  if (!pauseBody.safeParse(await optionalBody(c)).success) return invalid(c, 'Pause takes no body');
  await pauseRuntimeSchedule(db, c.req.param('id'), actorOf(c), new Date());
  return c.body(null, 204);
});

externalRoutes.post('/work-centers/:wc/runtime-schedules/:id/resume', control, ownRuntime, async (c) => {
  const parsed = resumeBody.safeParse(await optionalBody(c));
  if (!parsed.success) return invalid(c, 'Body must be { missed?, heldChains?, expectedMissedCount? }');
  // 202: this writes the decision down, and the engine's tick starts the runs.
  return send(c, await resumeRuntimeSchedule(db, c.req.param('id'), parsed.data, actorOf(c), new Date()), 202);
});

externalRoutes.post('/work-centers/:wc/runtime-schedules/:id/cancel', control, ownRuntime, async (c) => {
  const parsed = cancelBody.safeParse(await readBody(c));
  if (!parsed.success || parsed.data.reason.trim() === '') return invalid(c, 'Cancel needs a reason');
  if (parsed.data.reason.includes('\0')) return invalid(c, 'The reason cannot contain the NUL character (\\u0000)');
  await cancelRuntimeSchedule(db, c.req.param('id'), parsed.data.reason, actorOf(c), new Date());
  return c.body(null, 204);
});

externalRoutes.post('/work-centers/:wc/runtime-schedules/:id/acknowledge', control, ownRuntime, async (c) => {
  const parsed = acknowledgeBody.safeParse(await readBody(c));
  if (!parsed.success) return invalid(c, "Body must be { runIds: string[] | 'all' }");
  return send(c, { dismissed: await acknowledgeRuntimeItems(db, c.req.param('id'), parsed.data.runIds, actorOf(c), new Date()) });
});

externalRoutes.put('/work-centers/:wc/runtime-schedules/:id/items/:itemId/disabled', control, ownRuntime, ownItem, async (c) => {
  const parsed = disabledBody.safeParse(await readBody(c));
  if (!parsed.success) return invalid(c, 'Body must be { disabled: boolean }');
  await setRuntimeItemDisabled(db, c.req.param('itemId'), parsed.data.disabled, actorOf(c), new Date());
  return c.body(null, 204);
});
