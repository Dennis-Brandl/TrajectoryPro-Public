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
//
// Shared live Action-Property fetch (GATE spec 2026-08-29 §7 / Task 6, generalized by spec
// 2026-09-04 §5.4.3): resolve + fetch every binding's current value from the action server bound
// to the binding's environment. Callers run this OUTSIDE any transaction (§6.2) and pass which
// binding home to read — a GATE's gate_config, any other step's step-level list.
import { workflowInstance } from 'mission-control-db/src/db/schema/index';
import { eq } from 'drizzle-orm';
import type { Db } from '../db.js';
import type { EngineDeps } from '../config.js';
import type { ActionPropertyBinding, MasterWorkflowSpecification, MasterWorkflowStep } from '../spec/types.js';
import { findEnvSpec, findEnvSpecsByName, findStepDef } from '../loop.js';

export type PropertyOverlayResult =
  | { ok: true; overlay: Record<string, string> }
  | { ok: false; error: string };

/** Env spec resolves oid-then-name against the frozen recipe (owner scope then root — the
 *  invoke path's findEnvSpec precedence); server URI through the invoker's work-center binding
 *  lookup. Dotted `Prop.Entry` picks one entry; a bare group name serializes all entries as the
 *  resolvePropertyKey-style JSON array. Any miss returns {ok:false} — the caller turns it into a
 *  step failure (GATE ruling G3 / spec 2026-09-04 D4). `label` only shapes the error strings. */
export async function fetchPropertyOverlay(
  db: Db, deps: EngineDeps,
  p: { instanceId: string; stepOid: string; nodeOid: string; workCenterId: string },
  bindingsOf: (stepDef: MasterWorkflowStep) => ActionPropertyBinding[],
  label: 'gate binding' | 'input binding',
): Promise<PropertyOverlayResult> {
  const client = deps.invoker.client;
  const lookup = deps.invoker.bindingLookup;
  if (!client || !lookup) return { ok: false, error: `${label}s require a dispatching action invoker` };
  const [row] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, p.instanceId));
  if (!row) return { ok: false, error: `instance vanished during ${label} property fetch` };
  const spec = row.specJsonb as MasterWorkflowSpecification;
  const stepDef = findStepDef(spec, p.nodeOid, p.stepOid);
  const bindings = stepDef ? bindingsOf(stepDef) : [];
  const overlay: Record<string, string> = {};
  const cache = new Map<string, Array<{ name: string; value: string }>>();
  for (const b of bindings) {
    let envSpec = b.environment_oid ? findEnvSpec(spec, p.nodeOid, b.environment_oid) : undefined;
    if (!envSpec && b.environment_name) {
      const byName = findEnvSpecsByName(spec, p.nodeOid, b.environment_name);
      if (byName.length === 1) envSpec = byName[0];
    }
    const bindingEnvOid = envSpec?.oid ?? b.environment_oid;
    if (!bindingEnvOid) return { ok: false, error: `${label} for '${b.parameter_id}': no resolvable environment` };
    const serverUri = await lookup(p.workCenterId, bindingEnvOid);
    if (!serverUri) return { ok: false, error: `${label} for '${b.parameter_id}': no action server bound for environment ${bindingEnvOid}` };
    const [group, ...rest] = b.property.split('.');
    const key = `${bindingEnvOid}:${group}`;
    let entries = cache.get(key);
    if (!entries) {
      try {
        entries = (await client.getProperty(serverUri, group!, bindingEnvOid)).entries;
      } catch (err) {
        return { ok: false, error: `${label} for '${b.parameter_id}': ${err instanceof Error ? err.message : String(err)}` };
      }
      cache.set(key, entries);
    }
    if (rest.length === 0) {
      overlay[b.parameter_id] = JSON.stringify(
        entries.filter(e => e.name.toLowerCase() !== 'description').map(e => ({ name: e.name, value: e.value })));
    } else {
      const entryName = rest.join('.');
      const entry = entries.find(e => e.name === entryName);
      if (!entry) return { ok: false, error: `${label} for '${b.parameter_id}': property '${b.property}' has no entry '${entryName}'` };
      overlay[b.parameter_id] = entry.value;
    }
  }
  return { ok: true, overlay };
}
