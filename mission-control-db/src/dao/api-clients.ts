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

// API clients: per-system credentials for the external scheduling interface (spec 2026-11-08 §8.1).
// A token is `mcx_` + 256 random bits (base64url). Only its SHA-256 is stored, so a database
// read never yields a usable credential. The token itself exists once, in createApiClient's result.
import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, inArray, isNull, lte, or } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { apiClient, workCenter } from '../db/schema/index.js';
import type { Schema } from '../db/client.js';
import { DaoError } from './errors.js';

type Db = PgDatabase<any, Schema>;

export const API_CLIENT_SCOPES = ['schedules:read', 'schedules:write', 'schedules:control'] as const;
export type ApiClientScope = (typeof API_CLIENT_SCOPES)[number];

export const API_TOKEN_PREFIX = 'mcx_';
/** `mcx_` plus the 43 base64url characters of 32 random bytes. Anything else is not a token. */
const TOKEN_RE = /^mcx_[A-Za-z0-9_-]{43}$/;
/** Shown in the admin list so a person can tell tokens apart: `mcx_` + 4 characters. */
const DISPLAY_PREFIX_LENGTH = 8;
/** last_used_at is written at most this often per client. */
const LAST_USED_INTERVAL_MS = 60_000;

export type ApiClientView = {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: ApiClientScope[];
  /** Only work centers that still exist: a deleted one drops off. */
  workCenterIds: string[];
  createdBy: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  status: 'active' | 'revoked' | 'expired';
};

export type ApiClientPrincipal = {
  id: string;
  name: string;
  scopes: ApiClientScope[];
  workCenterIds: string[];
};

export function hashApiToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function existingWorkCenters(db: Db, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db.select({ id: workCenter.id }).from(workCenter).where(inArray(workCenter.id, ids));
  return new Set(rows.map((r) => r.id));
}

function toView(row: typeof apiClient.$inferSelect, live: Set<string>, now: Date): ApiClientView {
  const status = row.revokedAt ? 'revoked' : row.expiresAt && row.expiresAt <= now ? 'expired' : 'active';
  return {
    id: row.id,
    name: row.name,
    tokenPrefix: row.tokenPrefix,
    scopes: row.scopes as ApiClientScope[],
    workCenterIds: row.workCenterIds.filter((id) => live.has(id)),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    status,
  };
}

export async function createApiClient(
  db: Db,
  input: { name: string; scopes: ApiClientScope[]; workCenterIds: string[]; expiresAt?: Date },
  createdBy: string,
): Promise<{ client: ApiClientView; token: string }> {
  const scopes = [...new Set(input.scopes)];
  if (scopes.length === 0 || scopes.some((s) => !(API_CLIENT_SCOPES as readonly string[]).includes(s))) {
    throw new DaoError('INVALID_SCOPE', 'An API client needs one or more valid scopes');
  }
  const workCenterIds = [...new Set(input.workCenterIds)];
  const live = await existingWorkCenters(db, workCenterIds);
  if (workCenterIds.length === 0 || workCenterIds.some((id) => !live.has(id))) {
    throw new DaoError('WORK_CENTER_NOT_FOUND', 'Every work center for an API client must exist');
  }
  const token = API_TOKEN_PREFIX + randomBytes(32).toString('base64url');
  const [row] = await db.insert(apiClient).values({
    name: input.name,
    tokenHash: hashApiToken(token),
    tokenPrefix: token.slice(0, DISPLAY_PREFIX_LENGTH),
    scopes,
    workCenterIds,
    createdBy,
    expiresAt: input.expiresAt ?? null,
  }).returning();
  return { client: toView(row!, live, new Date()), token };
}

/**
 * The principal for a token, or null for an unknown, malformed, revoked or expired one.
 * Looking the SHA-256 up by index is safe because the input is 256 random bits: there is no
 * secret prefix to learn from lookup timing.
 */
export async function authenticateApiToken(db: Db, token: string, now: Date): Promise<ApiClientPrincipal | null> {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
  const [row] = await db.select().from(apiClient).where(eq(apiClient.tokenHash, hashApiToken(token)));
  if (!row || row.revokedAt) return null;
  if (row.expiresAt && row.expiresAt <= now) return null;
  const live = await existingWorkCenters(db, row.workCenterIds);
  // Bookkeeping only: it must never fail the request, and one conditional UPDATE keeps it to
  // one write a minute however many requests arrive at once.
  try {
    const cutoff = new Date(now.getTime() - LAST_USED_INTERVAL_MS);
    await db.update(apiClient).set({ lastUsedAt: now })
      .where(and(eq(apiClient.id, row.id), or(isNull(apiClient.lastUsedAt), lte(apiClient.lastUsedAt, cutoff))));
  } catch {
    /* ignore */
  }
  return {
    id: row.id,
    name: row.name,
    scopes: row.scopes as ApiClientScope[],
    workCenterIds: row.workCenterIds.filter((id) => live.has(id)),
  };
}

/** Soft and permanent: there is no un-revoke. Revoking twice keeps the first time. */
export async function revokeApiClient(db: Db, id: string, now: Date): Promise<void> {
  const [row] = await db.select({ id: apiClient.id }).from(apiClient).where(eq(apiClient.id, id));
  if (!row) throw new DaoError('API_CLIENT_NOT_FOUND', 'No such API client');
  await db.update(apiClient).set({ revokedAt: now }).where(and(eq(apiClient.id, id), isNull(apiClient.revokedAt)));
}

/** Every client, newest first. Never includes the token or its hash. */
export async function listApiClients(db: Db, now: Date = new Date()): Promise<ApiClientView[]> {
  const rows = await db.select().from(apiClient).orderBy(desc(apiClient.createdAt));
  const live = await existingWorkCenters(db, [...new Set(rows.flatMap((r) => r.workCenterIds))]);
  return rows.map((r) => toView(r, live, now));
}
