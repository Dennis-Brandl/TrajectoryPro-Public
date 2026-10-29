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
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../lib/db';
import {
  listRuntimeHistoryPage, getRuntimeHistoryDetail, deleteRuntimeHistory,
  countRuntimeHistoryBefore, purgeRuntimeHistory, historyRowGate,
} from 'mission-control-db/src/dao/runtime-history';
import { isMissionSystemCommander } from 'mission-control-db/src/dao/work-centers';
import { requireSession, requirePermission, requireAdministrator, type Vars } from '../middleware/auth';
import { requireUuidParams } from '../middleware/validate';
import { httpError, sendError } from '../lib/errors';

export const runtimeHistoryRoutes = new Hono<{ Variables: Vars }>();
runtimeHistoryRoutes.use('/work-centers/:id/runtime-history', requireSession);
runtimeHistoryRoutes.use('/runtime-history', requireSession);
runtimeHistoryRoutes.use('/runtime-history/*', requireSession);

const isoDate = z.coerce.date().refine((d) => Number.isFinite(d.getTime()), 'invalid date');
const listQuery = z.object({
  state: z.enum(['completed', 'aborted', 'stopped', 'errored']).optional(),
  search: z.string().max(200).optional(),
  from: isoDate.optional(), to: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
}).strict();
const crossQuery = listQuery.extend({
  workCenterId: z.string().uuid().optional(),
  orphans: z.literal('true').optional(),
}).refine((q) => !(q.workCenterId && q.orphans), { message: 'workCenterId and orphans are exclusive' });
const toFilter = (q: z.infer<typeof crossQuery> | z.infer<typeof listQuery>, wcId?: string) => ({
  workCenterId: wcId ?? ('workCenterId' in q ? q.workCenterId : undefined),
  orphansOnly: 'orphans' in q && q.orphans === 'true' ? true : undefined,
  finalState: q.state, nameSearch: q.search, finishedFrom: q.from, finishedTo: q.to,
  page: q.page, pageSize: q.pageSize,
});

// Monitoring stays deliberately open (phase-6 precedent): every tier holds work_center:read.
runtimeHistoryRoutes.get('/work-centers/:id/runtime-history', requireUuidParams('id'), requirePermission('work_center:read'), async (c) => {
  const parsed = listQuery.safeParse(c.req.query());
  if (!parsed.success) return httpError(c, 400, 'validation', 'Invalid history query');
  const { items, total, page, pageSize } = await listRuntimeHistoryPage(db, toFilter(parsed.data, c.req.param('id')));
  return c.json({ history: items, total, page, pageSize });
});

runtimeHistoryRoutes.get('/runtime-history', requirePermission('work_center:read'), async (c) => {
  const parsed = crossQuery.safeParse(c.req.query());
  if (!parsed.success) return httpError(c, 400, 'validation', 'Invalid history query');
  const { items, total, page, pageSize } = await listRuntimeHistoryPage(db, toFilter(parsed.data));
  return c.json({ history: items, total, page, pageSize });
});

const purgeBody = z.object({ olderThan: isoDate, workCenterId: z.string().uuid().optional() }).strict();

// Admin-only purge pair — registered BEFORE '/runtime-history/:id' AND ':id' is uuid-guarded,
// so 'purge-count'/'purge' can never be captured as an id (both defenses on purpose).
runtimeHistoryRoutes.get('/runtime-history/purge-count', requireAdministrator, async (c) => {
  const parsed = purgeBody.safeParse(c.req.query());
  if (!parsed.success) return httpError(c, 400, 'validation', 'Invalid purge query');
  return c.json({ count: await countRuntimeHistoryBefore(db, parsed.data) });
});
runtimeHistoryRoutes.post('/runtime-history/purge', requireAdministrator, async (c) => {
  const parsed = purgeBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return httpError(c, 400, 'validation', 'Invalid purge payload');
  return c.json({ deleted: await purgeRuntimeHistory(db, parsed.data) });
});

runtimeHistoryRoutes.get('/runtime-history/:id', requireUuidParams('id'), requirePermission('work_center:read'), async (c) => {
  const detail = await getRuntimeHistoryDetail(db, c.req.param('id'));
  if (!detail) return httpError(c, 404, 'not_found', 'History entry not found');
  return c.json(detail);
});

// Bespoke gate (spec D3): admin passes; else Mission System Commander of the row's WC; an orphaned
// row (WC deleted -> null) is therefore admin-only by construction.
runtimeHistoryRoutes.delete('/runtime-history/:id', requireUuidParams('id'), async (c) => {
  const principal = c.get('principal');
  const row = await historyRowGate(db, c.req.param('id'));
  if (!row) return httpError(c, 404, 'not_found', 'History entry not found');
  const allowed = principal.accessLevel === 'administrator'
    || (row.workCenterId !== null && await isMissionSystemCommander(db, row.workCenterId, principal.userId));
  if (!allowed) return httpError(c, 403, 'forbidden', 'Requires Mission System Commander for this work center');
  try { await deleteRuntimeHistory(db, c.req.param('id')); return c.body(null, 204); }
  catch (err) { return sendError(c, err, 'Delete failed'); }
});
