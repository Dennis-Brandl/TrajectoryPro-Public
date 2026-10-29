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

import { DaoError } from '../dao/errors.js';

/** Matches dao/workflow-diagram.ts's cap; a recipe can never be deeper than its master renders. */
const MAX_SPEC_DEPTH = 50;
export const MAX_STARTING_PARAMS = 200;
export const MAX_STARTING_PARAM_VALUE_LENGTH = 10_000;

export type StartingParameterSpec = {
  id: string;
  description: string | null;
  default_value: string;
  value_type: 'literal' | 'property';
};

type AnyRecord = Record<string, unknown>;
function isRecord(v: unknown): v is AnyRecord {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function invalid(msg: string): never { throw new DaoError('RUNTIME_MASTER_INVALID', msg); }

/**
 * ISA-88 master→control-recipe copy. Port of TrajectoryRuntime engines/web/src/spec-copy.ts
 * deepCopySpec: same two passes, same remap set, same preserved set, same rt_N assignment
 * order (all spec OIDs depth-first, then steps per spec root-first). Implemented as
 * structuredClone + in-place remap: output-identical to the reference's rebuild-by-spread,
 * and unknown fields survive schema drift by riding the clone. The counter restarts per
 * call — each recipe is self-contained and execution rows key on (workflow_instance_id, oid).
 */
export function instantiateSpec(master: unknown): AnyRecord {
  if (!isRecord(master) || typeof master.oid !== 'string') invalid('master spec must be an object with an oid');
  if (!Array.isArray(master.steps)) invalid('master spec has no steps array');
  if (!Array.isArray(master.connections)) invalid('master spec has no connections array');
  const spec = structuredClone(master);
  let n = 0;
  const nextOid = () => `rt_${++n}`;
  const specOidMap = new Map<string, string>();
  collectSpecOids(spec, specOidMap, nextOid, 0);
  remapSpec(spec, specOidMap, nextOid);
  return spec;
}

function collectSpecOids(spec: AnyRecord, map: Map<string, string>, nextOid: () => string, depth: number): void {
  if (depth > MAX_SPEC_DEPTH) invalid('spec nesting exceeds MAX_SPEC_DEPTH');
  if (typeof spec.oid !== 'string') invalid('a child spec is missing its oid');
  if (!map.has(spec.oid)) map.set(spec.oid, nextOid());
  if (Array.isArray(spec.children)) {
    for (const child of spec.children) {
      if (!isRecord(child)) invalid('a child spec is not an object');
      collectSpecOids(child, map, nextOid, depth + 1);
    }
  }
}

function remapSpec(spec: AnyRecord, specOidMap: Map<string, string>, nextOid: () => string): void {
  // Phase 4a provenance: keep the master's spec oid so a parked step's owning node can be
  // mapped back to workflow_node (role resolution). Stamped BEFORE the remap overwrites oid;
  // recursion below stamps every child level the same way. The workflow JSON schema has no
  // additionalProperties:false, so the extra key passes engine validation untouched.
  spec.master_oid = spec.oid;
  spec.oid = specOidMap.get(spec.oid as string) ?? spec.oid;
  const steps = Array.isArray(spec.steps) ? spec.steps : [];
  const stepOidMap = new Map<string, string>();
  for (const step of steps) {
    if (!isRecord(step) || typeof step.oid !== 'string') invalid('a step is missing its oid');
    stepOidMap.set(step.oid, nextOid());
  }
  for (const step of steps as AnyRecord[]) {
    step.oid = stepOidMap.get(step.oid as string)!;
    const rc = step.return_config;
    if (isRecord(rc) && typeof rc.goto_step_oid === 'string') {
      rc.goto_step_oid = stepOidMap.get(rc.goto_step_oid) ?? rc.goto_step_oid;
    }
    remapResourceCommands(step.resource_command_specifications, specOidMap);
  }
  if (Array.isArray(spec.connections)) {
    for (const conn of spec.connections as AnyRecord[]) {
      if (!isRecord(conn)) continue;
      if (typeof conn.from_step_id === 'string') conn.from_step_id = stepOidMap.get(conn.from_step_id) ?? conn.from_step_id;
      if (typeof conn.to_step_id === 'string') conn.to_step_id = stepOidMap.get(conn.to_step_id) ?? conn.to_step_id;
    }
  }
  remapResourceCommands(spec.resource_command_specifications, specOidMap);
  if (Array.isArray(spec.children)) {
    for (const child of spec.children as AnyRecord[]) remapSpec(child, specOidMap, nextOid);
  }
}

/** Only workflow-scoped resource sources remap; environment sources are external identities. */
function remapResourceCommands(cmds: unknown, specOidMap: Map<string, string>): void {
  if (!Array.isArray(cmds)) return;
  for (const cmd of cmds as AnyRecord[]) {
    if (!isRecord(cmd)) continue;
    if (typeof cmd.resource_source_oid === 'string' && cmd.resource_source_type !== 'environment') {
      cmd.resource_source_oid = specOidMap.get(cmd.resource_source_oid) ?? cmd.resource_source_oid;
    }
  }
}

/** Project starting_parameter_specifications for display/validation. Junk entries are
 *  dropped, not fatal — the master was already accepted at load time. */
export function startingParameterSpecs(master: unknown): StartingParameterSpec[] {
  if (!isRecord(master) || !Array.isArray(master.starting_parameter_specifications)) return [];
  const out: StartingParameterSpec[] = [];
  for (const p of master.starting_parameter_specifications) {
    if (!isRecord(p) || typeof p.id !== 'string') continue;
    out.push({
      id: p.id,
      description: typeof p.description === 'string' ? p.description : null,
      default_value: typeof p.default_value === 'string' ? p.default_value : '',
      value_type: p.value_type === 'property' ? 'property' : 'literal',
    });
  }
  return out;
}

/**
 * Returns ONLY caller-entered values (spec §4.2 as refined): the engine's
 * initializeStartingParameters treats a present key as caller-supplied and skips
 * default/property resolution, so defaults must NOT be merged in here.
 */
export function validateStartingParams(
  specs: StartingParameterSpec[],
  entered: unknown,
  opts: { ignoreUnknown?: boolean } = {},
): Record<string, string> {
  if (entered == null) return {};
  if (!isRecord(entered)) throw new DaoError('RUNTIME_PARAM_INVALID', 'params must be an object');
  const ids = new Set(specs.map((s) => s.id));
  // ignoreUnknown: names the master does not declare are dropped, not rejected (loose matching).
  const keys = Object.keys(entered).filter((k) => !opts.ignoreUnknown || ids.has(k));
  if (keys.length > MAX_STARTING_PARAMS) throw new DaoError('RUNTIME_PARAM_INVALID', 'too many parameters');
  const out: Record<string, string> = {};
  for (const key of keys) {
    if (!ids.has(key)) throw new DaoError('RUNTIME_PARAM_INVALID', `unknown parameter: ${key}`);
    const v = entered[key];
    if (typeof v !== 'string') throw new DaoError('RUNTIME_PARAM_INVALID', `parameter ${key} must be a string`);
    if (v.length > MAX_STARTING_PARAM_VALUE_LENGTH) throw new DaoError('RUNTIME_PARAM_INVALID', `parameter ${key} exceeds length cap`);
    out[key] = v;
  }
  return out;
}
