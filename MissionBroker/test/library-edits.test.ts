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

import { expect, test } from 'vitest';
// @ts-expect-error — plain .mjs helper shared with the CLI script
import { planLibraryEdits, CODE_TEXT } from '../scripts/library-edits.mjs';

const vp = (id: string, name: string, entries: Array<[string, string]>) =>
  ({ id, name, entries: entries.map(([n, v], i) => ({ id: `${id}${i + 1}`, name: n, value: v })) });

const ACTION = (name: string, extraOut: Array<ReturnType<typeof vp>> = []) => ({
  id: `spec-${name}`, name, dataSchemaVersion: 3,
  data: { nodes: [], inputs: [vp('1', 'RuntimeWorkflow', [['ID', ''], ['Description', 'x']])],
    outputs: [vp('2', 'Completion', [['Code', ''], ['Description', '0-No Error, 1= Error']]), vp('3', 'Error', [['Text', ''], ['Description', '']]), ...extraOut] },
});

test('codes on every action, Label on both creates, two new actions, environment extended', () => {
  const create = ACTION('Create Runtime Workflow', [vp('4', 'RuntimeWorkflow', [['ID', ''], ['Description', 'y']])]);
  const abort = ACTION('Abort Runtime Workflow');
  let n = 0;
  const plan = planLibraryEdits([create, abort], { id: 'env', data: { nodes: [], included_actions: [{ action_name: 'Abort Runtime Workflow', action_library: 'Distributed Workflow Action Library' }] } }, () => String(++n));
  expect(plan.updates).toHaveLength(2);
  for (const u of plan.updates) {
    const completion = u.data.outputs.find((o: { name: string }) => o.name === 'Completion');
    expect(completion.entries.find((e: { name: string }) => e.name === 'Description').value).toBe(CODE_TEXT);
  }
  const cu = plan.updates.find((u: { id: string }) => u.id === 'spec-Create Runtime Workflow');
  expect(cu.data.outputs.find((o: { name: string }) => o.name === 'RuntimeWorkflow').entries.map((e: { name: string }) => e.name)).toEqual(['ID', 'Label', 'Description']);
  expect(plan.creates.map((c: { name: string }) => c.name)).toEqual(['Wait for Runtime Workflow', 'Get Runtime Workflow Outputs']);
  expect(plan.envData.included_actions.map((a: { action_name: string }) => a.action_name)).toEqual([
    'Abort Runtime Workflow', 'Wait for Runtime Workflow', 'Get Runtime Workflow Outputs',
  ]);
});

test('running it twice changes nothing more', () => {
  const done = (spec: ReturnType<typeof ACTION>) => { spec.data.outputs[0].entries[1].value = CODE_TEXT; return spec; };
  const specs = [
    done(ACTION('Create Runtime Workflow', [vp('4', 'RuntimeWorkflow', [['ID', ''], ['Label', ''], ['Description', 'y']])])),
    done(ACTION('Wait for Runtime Workflow')),
    done(ACTION('Get Runtime Workflow Outputs')),
  ];
  const plan = planLibraryEdits(specs, { id: 'env', data: { included_actions: [
    { action_name: 'Wait for Runtime Workflow' }, { action_name: 'Get Runtime Workflow Outputs' }] } }, () => 'x');
  expect(plan.updates).toEqual([]);
  expect(plan.creates).toEqual([]);
  expect(plan.envData).toBeNull();
});

// @ts-expect-error — plain .mjs helper
import { assertEditable, skipReasons } from '../scripts/library-edits.mjs';

const draft = (name: string) => ({ name, state: 'Draft', version: '1.0.0' });

test('assertEditable passes lone Drafts', () => {
  expect(() => assertEditable([draft('A'), draft('B')], { id: 'e', ...draft('Env') })).not.toThrow();
});
test('assertEditable refuses a non-Draft action', () => {
  expect(() => assertEditable([draft('A'), { ...draft('B'), state: 'Effective' }], { id: 'e', ...draft('Env') })).toThrow(/B 1.0.0 is Effective/);
});
test('assertEditable refuses a duplicate name', () => {
  expect(() => assertEditable([draft('A'), draft('A')], { id: 'e', ...draft('Env') })).toThrow(/A has 2 root versions/);
});
test('assertEditable refuses a non-Draft environment', () => {
  expect(() => assertEditable([draft('A')], { id: 'e', ...draft('Env'), state: 'Approved' })).toThrow(/environment Env/);
});
test('skipReasons names why a spec gets no update', () => {
  const noCompletion = { id: 'x', name: 'X', data: { outputs: [] } };
  expect(skipReasons([noCompletion], [])).toEqual([{ name: 'X', reason: 'no Completion.Description entry' }]);
});
