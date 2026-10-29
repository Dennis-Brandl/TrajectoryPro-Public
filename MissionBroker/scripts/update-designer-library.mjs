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

// Usage (never print the credentials):
//   DESIGNER_URL=http://localhost:3000 DESIGNER_EMAIL=... DESIGNER_PASSWORD=... \
//   node scripts/update-designer-library.mjs [--apply]
// Without --apply it prints the planned edits and writes nothing.
import { planLibraryEdits, assertEditable, skipReasons, LIBRARY_NAME } from './library-edits.mjs';

const base = process.env.DESIGNER_URL ?? 'http://localhost:3000';
const apply = process.argv.includes('--apply');
const LIBRARY_ID = '73551f50-c6f2-4285-bbb3-72ae98c01da5';   // GLOBAL "Distributed Workflow Action Library"
const ENV_ID = '66d683f9-7284-429d-a9a8-26562cd9860e';       // environment "Distributed Workflow Management"

let cookie = '';
async function call(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', origin: base, ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length) cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

await call('POST', '/api/auth/sign-in/email', { email: process.env.DESIGNER_EMAIL, password: process.env.DESIGNER_PASSWORD });
// GET /api/v2/libraries/:id/specifications → { library, specs: SpecMeta[] } (no data);
// GET /api/v2/specifications/:id → { spec } with data (MissionDesigner/src/server/routes/v2).
const parse = (d) => (typeof d === 'string' ? JSON.parse(d) : d);
const { specs: metas } = await call('GET', `/api/v2/libraries/${LIBRARY_ID}/specifications`);
const specs = [];
for (const m of metas) {
  const { spec } = await call('GET', `/api/v2/specifications/${m.id}`);
  specs.push({ id: spec.id, name: spec.name, state: m.state ?? spec.state, version: m.version ?? spec.version, dataSchemaVersion: spec.dataSchemaVersion, data: parse(spec.data) });
}
const { spec: envSpec } = await call('GET', `/api/v2/specifications/${ENV_ID}`);
const env = { id: ENV_ID, name: envSpec.name, state: envSpec.state, version: envSpec.version, data: parse(envSpec.data) };

// The login is an admin, which bypasses Designer's edit lock: refuse anything not a lone Draft.
try { assertEditable(specs, env); } catch (e) { console.error(e.message); process.exit(1); }

let seq = 0n;
const newId = () => String(BigInt(Date.now()) * 1000000n + seq++);
const plan = planLibraryEdits(specs, env, newId);
console.log(`updates: ${plan.updates.map((u) => specs.find((s) => s.id === u.id).name).join(', ') || 'none'}`);
console.log(`creates: ${plan.creates.map((c) => c.name).join(', ') || 'none'}`);
for (const s of skipReasons(specs, plan.updates)) console.log(`  no update: ${s.name} (${s.reason})`);
console.log(`environment: ${plan.envData ? 'included_actions extended' : 'unchanged'}`);
if (!apply) { console.log('dry run — pass --apply to write'); process.exit(0); }

const byId = new Map(specs.map((s) => [s.id, s]));
// dataSchemaVersion is optional on update (requestSchema.ts:43) but required on create: reuse the library's own.
const createVersion = specs.find((s) => Number.isInteger(s.dataSchemaVersion))?.dataSchemaVersion;
if (plan.creates.length && createVersion === undefined) { console.error('no dataSchemaVersion to stamp new actions with'); process.exit(1); }
const ver = (v) => (Number.isInteger(v) ? { dataSchemaVersion: v } : {});
await call('POST', '/api/v2/specifications/batch-save', {
  specs: [
    ...plan.updates.map((u) => ({ op: 'update', id: u.id, data: JSON.stringify(u.data), ...ver(byId.get(u.id).dataSchemaVersion) })),
    ...plan.creates.map((c) => ({
      op: 'create', id: c.id, rootSpecificationId: c.id, libraryId: LIBRARY_ID, name: c.name,
      description: c.description, data: JSON.stringify(c.data), dataSchemaVersion: createVersion,
    })),
    ...(plan.envData ? [{ op: 'update', id: ENV_ID, data: JSON.stringify(plan.envData), ...ver(envSpec.dataSchemaVersion) }] : []),
  ],
  proxyRefs: [], specEnvs: [], imageDeletes: [], imageRefs: [],
});
console.log(`applied to ${LIBRARY_NAME}`);
