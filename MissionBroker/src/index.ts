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

import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { serve } from '@hono/node-server';
import * as schema from 'mission-control-db/src/db/schema/index';
import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { EventHub } from './events.js';
import { checkWaits } from './waits.js';
import { purgeOldRecords, RETENTION_INTERVAL_MS } from './retention.js';

const cfg = loadConfig();
const pool = new pg.Pool({ connectionString: cfg.databaseUrl, max: 5 });
// An idle pooled client that loses its connection emits 'error' on the pool; unhandled, that
// would crash the process. The pool replaces the client on the next query.
pool.on('error', (e) => console.error('[broker] idle database connection error:', e));
const db = drizzle(pool, { schema });
const hub = new EventHub();

let checking = false;
let rerun = false;
async function tick(): Promise<void> {
  // A wake that arrives mid-check is remembered and triggers exactly one more pass.
  if (checking) { rerun = true; return; }
  checking = true;
  try {
    do {
      rerun = false;
      try { await checkWaits(db, hub); }
      catch (err) { console.error('[broker] wait check failed:', err); }
    } while (rerun);
  } finally { checking = false; }
}

// The engine's own wake channel (mission-control-db drizzle/0018): fires on every
// workflow_instance status and step_instance state change — exactly when a wait can end.
function listen(): void {
  const client = new pg.Client({ connectionString: cfg.databaseUrl });
  let retried = false;
  const retry = () => {
    if (retried) return;
    retried = true;
    client.removeAllListeners();
    client.on('error', () => {}); // a late error on the discarded client must not crash the process
    client.end().catch(() => {});
    setTimeout(listen, 2000);
  };
  client.on('notification', () => { void tick(); });
  client.on('error', retry);
  client.on('end', retry);
  // Once listening (first connect or a reconnect), check at once: wakes sent while we were
  // disconnected were lost, and the poll may be up to pollMs away.
  client.connect().then(() => client.query('LISTEN engine_wake')).then(() => { void tick(); }).catch(retry);
}

async function sweepRetention(): Promise<void> {
  try {
    const n = await purgeOldRecords(db, new Date(), cfg.retentionDays);
    if (n > 0) console.log(`[broker] retention: deleted ${n} call record(s) older than ${cfg.retentionDays} days`);
  } catch (err) { console.error('[broker] retention sweep failed:', err); }
}

listen();
setInterval(() => { void tick(); }, cfg.pollMs);
void tick();
void sweepRetention();
setInterval(() => { void sweepRetention(); }, RETENTION_INTERVAL_MS);

serve({ fetch: createApp({ db, hub, now: () => new Date(), token: cfg.token, corsOrigins: cfg.corsOrigins }).fetch, port: cfg.port }, (info) => {
  console.log(`[broker] Mission Broker listening on ${info.port}`);
});
