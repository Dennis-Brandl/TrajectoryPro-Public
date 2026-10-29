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

import { describe, expect, test, it } from 'vitest';
import {
  instantiateSpec, startingParameterSpecs, validateStartingParams,
  MAX_STARTING_PARAMS, MAX_STARTING_PARAM_VALUE_LENGTH,
} from './instantiate.js';
import { DaoError } from '../dao/errors.js';

const FIXTURE = {
  local_id: 'Root', oid: 'wf-root', version: '2.0.0', state: 'Effective', schemaVersion: '4.0',
  starting_parameter_specifications: [
    { id: 'BatchSize', default_value: '10', value_type: 'literal', description: 'Units per batch' },
    { id: 'Recipe', default_value: 'Std.Recipe', value_type: 'property' },
  ],
  value_property_specifications: [{ oid: 'vp-1', name: 'Std', entries: [{ name: 'Recipe', value: 'R-100' }] }],
  resource_command_specifications: [
    { oid: 'rc-1', command: 'Acquire', resource_source_type: 'workflow', resource_source_oid: 'wf-child' },
    { oid: 'rc-2', command: 'Acquire', resource_source_type: 'environment', resource_source_oid: 'env-55' },
  ],
  steps: [
    {
      local_id: 'Start', oid: 's-1', step_type: 'START', position: { x: 0, y: 0 },
      // Step-level resource_command_specifications: remapSpec remaps these per-step, not just
      // at the spec level (line above) — a regression dropping the per-step call would still
      // pass if only the spec-level list were exercised.
      resource_command_specifications: [
        { oid: 'rc-3', command: 'Acquire', resource_source_type: 'workflow', resource_source_oid: 'wf-child' },
        { oid: 'rc-4', command: 'Acquire', resource_source_type: 'environment', resource_source_oid: 'env-55' },
      ],
    },
    { local_id: 'Retry', oid: 's-2', step_type: 'RETURN', return_config: { command: 'GOTO', goto_step_oid: 's-1' } },
    { local_id: 'Child', oid: 's-3', step_type: 'WORKFLOW PROXY' },
    { local_id: 'End', oid: 's-4', step_type: 'END' },
  ],
  connections: [
    { connection_id: 'c-1', from_step_id: 's-1', to_step_id: 's-3', source_handle_id: 'h-1' },
    { connection_id: 'c-2', from_step_id: 's-3', to_step_id: 's-4' },
  ],
  children: [{
    local_id: 'Child', oid: 'wf-child',
    steps: [{ local_id: 'CStart', oid: 'cs-1', step_type: 'START' }],
    connections: [],
  }],
};

type AnySpec = Record<string, any>;

function allStepOids(spec: AnySpec): string[] {
  return [
    ...(spec.steps ?? []).map((s: AnySpec) => s.oid),
    ...(spec.children ?? []).flatMap((c: AnySpec) => allStepOids(c)),
  ];
}

test('every step and spec oid is regenerated rt_-prefixed and unique; master is not mutated', () => {
  const master = structuredClone(FIXTURE);
  const out = instantiateSpec(master) as AnySpec;
  const stepOids = allStepOids(out);
  expect(stepOids.every((o) => o.startsWith('rt_'))).toBe(true);
  expect(new Set([out.oid, out.children[0].oid, ...stepOids]).size).toBe(2 + stepOids.length);
  expect(out.oid).not.toBe('wf-root');
  expect(out.children[0].oid).not.toBe('wf-child');
  expect(master.steps[0].oid).toBe('s-1');                     // input untouched
});

test('connections, RETURN GOTO, and workflow-scoped resource sources are remapped; env-scoped is not', () => {
  const out = instantiateSpec(structuredClone(FIXTURE)) as AnySpec;
  const byLocal = Object.fromEntries(out.steps.map((s: AnySpec) => [s.local_id, s]));
  expect(out.connections[0].from_step_id).toBe(byLocal.Start.oid);
  expect(out.connections[0].to_step_id).toBe(byLocal.Child.oid);
  expect(byLocal.Retry.return_config.goto_step_oid).toBe(byLocal.Start.oid);
  expect(out.resource_command_specifications[0].resource_source_oid).toBe(out.children[0].oid);
  expect(out.resource_command_specifications[1].resource_source_oid).toBe('env-55');
  // Same remap, at the STEP level (spec §remapResourceCommands is called once per step too).
  expect(byLocal.Start.resource_command_specifications[0].resource_source_oid).toBe(out.children[0].oid);
  expect(byLocal.Start.resource_command_specifications[1].resource_source_oid).toBe('env-55');
});

test('preserved fields survive: local_id, connection_id, source_handle_id, version, state, spec-level oids', () => {
  const out = instantiateSpec(structuredClone(FIXTURE)) as AnySpec;
  expect(out.local_id).toBe('Root');
  expect(out.version).toBe('2.0.0');
  expect(out.state).toBe('Effective');
  expect(out.connections[0].connection_id).toBe('c-1');
  expect(out.connections[0].source_handle_id).toBe('h-1');
  expect(out.value_property_specifications[0].oid).toBe('vp-1');
  expect(out.starting_parameter_specifications.map((p: AnySpec) => p.id)).toEqual(['BatchSize', 'Recipe']);
});

test('malformed masters throw RUNTIME_MASTER_INVALID', () => {
  for (const bad of [null, 42, {}, { oid: 'x', steps: [{ step_type: 'START' }] }]) {
    expect(() => instantiateSpec(bad)).toThrowError(DaoError);
    try { instantiateSpec(bad); } catch (e) { expect((e as DaoError).code).toBe('RUNTIME_MASTER_INVALID'); }
  }
});

test('deep nesting beyond 50 throws RUNTIME_MASTER_INVALID', () => {
  const root: AnySpec = { oid: 'd-0', steps: [], connections: [] };
  let cur = root;
  for (let i = 1; i <= 60; i++) { cur.children = [{ oid: `d-${i}`, steps: [], connections: [] }]; cur = cur.children[0]; }
  try { instantiateSpec(root); expect.unreachable(); } catch (e) { expect((e as DaoError).code).toBe('RUNTIME_MASTER_INVALID'); }
});

describe('master_oid provenance stamp (phase 4a)', () => {
  it('stamps every spec level with its pre-remap oid', () => {
    const master = structuredClone(FIXTURE);
    const recipe = instantiateSpec(master) as any;
    expect(recipe.master_oid).toBe(master.oid);
    expect(recipe.oid).not.toBe(master.oid);
    const child = recipe.children[0];
    expect(child.master_oid).toBe((master as any).children[0].oid);
    expect(child.oid).not.toBe(child.master_oid);
  });

  it('does not mutate the master', () => {
    const master = structuredClone(FIXTURE);
    const before = JSON.stringify(master);
    instantiateSpec(master);
    expect(JSON.stringify(master)).toBe(before);
  });
});

test('startingParameterSpecs projects and normalizes; tolerates junk entries', () => {
  expect(startingParameterSpecs(FIXTURE)).toEqual([
    { id: 'BatchSize', description: 'Units per batch', default_value: '10', value_type: 'literal' },
    { id: 'Recipe', description: null, default_value: 'Std.Recipe', value_type: 'property' },
  ]);
  expect(startingParameterSpecs({ starting_parameter_specifications: [{ nope: 1 }, null] })).toEqual([]);
  expect(startingParameterSpecs(null)).toEqual([]);
});

test('validateStartingParams: entered-only storage, unknown/non-string/too-long/too-many rejected', () => {
  const specs = startingParameterSpecs(FIXTURE);
  expect(validateStartingParams(specs, { BatchSize: '25' })).toEqual({ BatchSize: '25' }); // Recipe NOT merged in
  expect(validateStartingParams(specs, undefined)).toEqual({});
  const reject = (entered: unknown) => {
    try { validateStartingParams(specs, entered); expect.unreachable(); }
    catch (e) { expect((e as DaoError).code).toBe('RUNTIME_PARAM_INVALID'); }
  };
  reject({ Unknown: 'x' });
  reject({ BatchSize: 7 });
  reject({ BatchSize: 'x'.repeat(MAX_STARTING_PARAM_VALUE_LENGTH + 1) });
  reject(Object.fromEntries(Array.from({ length: MAX_STARTING_PARAMS + 1 }, (_, i) => [`p${i}`, 'v'])));
  reject('not-an-object');
});
