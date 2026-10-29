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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): { databaseUrl: string; port: number; pollMs: number; retentionDays: number; token: string; corsOrigins: string[] } {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const port = Number(env.BROKER_PORT ?? 3007);
  const pollMs = Number(env.BROKER_POLL_MS ?? 5000);
  if (!Number.isInteger(port) || port <= 0) throw new Error('BROKER_PORT must be a port number');
  if (!Number.isFinite(pollMs) || pollMs < 250) throw new Error('BROKER_POLL_MS must be at least 250');
  const rawDays = env.BROKER_RETENTION_DAYS;
  const retentionDays = rawDays === undefined || rawDays === '' ? 14 : Number(rawDays);
  if (!Number.isInteger(retentionDays) || retentionDays < 1) throw new Error('BROKER_RETENTION_DAYS must be a whole number of days, at least 1');
  const token = (env.MISSION_BROKER_TOKEN ?? '').trim();
  if (token.length < 32) throw new Error('MISSION_BROKER_TOKEN is required (at least 32 characters); the broker will not start without it');
  const origins = (env.BROKER_CORS_ORIGINS ?? '').split(',').map((o) => o.trim()).filter((o) => o !== '');
  const corsOrigins = origins.length > 0 ? origins : ['http://localhost:3004', 'http://127.0.0.1:3004'];
  return { databaseUrl, port, pollMs, retentionDays, token, corsOrigins };
}
