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

import type { PgDatabase } from 'drizzle-orm/pg-core';
import { getEnvironmentBinding } from '../dao/environment-bindings.js';
import { getActionServerPolicy } from '../dao/system-settings.js';
import type { Schema } from '../db/client.js';
type Db = PgDatabase<any, Schema>;

// Same acceptance as the engine's server-URI check: parses as a URL with an http(s) scheme.
function validServerUri(uri: string): boolean {
  try {
    const p = new URL(uri).protocol;
    return p === 'http:' || p === 'https:';
  } catch { return false; }
}

// Load-time warnings about action-server configuration. Warnings only; never fails a load.
// Pass a workflow's env specs from every depth (nestedEnvironmentSpecs) or a package's specs.
export async function actionServerWarnings(db: Db, workCenterId: string, envSpecs: any[]): Promise<string[]> {
  const out = new Set<string>();
  const policy = await getActionServerPolicy(db);
  for (const es of envSpecs) {
    if (!es || typeof es !== 'object') continue;
    const id = es.local_id;
    for (const as of es.action_server_specifications ?? []) {
      const uri = typeof as?.uri === 'string' ? as.uri : '';
      if (uri.trim() === '') continue;
      if (!validServerUri(uri)) {
        out.add(`Environment "${id}" has an action server "${as.name || '(unnamed)'}" with an invalid URI "${uri}". Fix it in Designer, then re-export and re-load.`);
      }
    }
    if (!Array.isArray(es.included_actions) || es.included_actions.length === 0) continue;
    const bound = await getEnvironmentBinding(db, workCenterId, es.oid);
    if (!bound) {
      out.add(`Environment "${id}" has no action server bound in this work center. Set it under the work center's environment bindings before running.`);
      continue;
    }
    if (policy.trust === 'strict') {
      let origin: string | null = null;
      try { origin = new URL(bound).origin; } catch { /* unparseable: engine rejects it anyway */ }
      if (origin === null || !policy.allowlist.includes(origin)) {
        out.add(`Environment "${id}" is bound to ${bound}, which is not on the action-server allowlist. Add it under Settings → Action server trust.`);
      }
    }
  }
  return [...out];
}
