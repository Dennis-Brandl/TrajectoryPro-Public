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
import { readInput, readStartingParameters, group, completionOutputs } from '../src/wire.js';
import { ACTIONS, findAction, BROKER_ENV } from '../src/catalog.js';

const list = (o: Record<string, string>) => JSON.stringify(Object.entries(o).map(([name, value]) => ({ name, value })));

test('readInput: plain value, whole-property list by entry name, missing', () => {
  expect(readInput([{ name: 'RuntimeWorkflow', value: 'abc' }], 'RuntimeWorkflow', 'ID')).toBe('abc');
  expect(readInput([{ name: 'RuntimeWorkflow', value: list({ ID: 'abc', Label: 'RW-1' }) }], 'RuntimeWorkflow', 'ID')).toBe('abc');
  expect(readInput([{ name: 'RuntimeWorkflow', value: list({ id: 'abc' }) }], 'RuntimeWorkflow', 'ID')).toBe('abc');
  expect(readInput([{ name: 'RuntimeWorkflow', value: list({ Other: 'x' }) }], 'RuntimeWorkflow', 'ID')).toBe('');
  expect(readInput([], 'WorkCenter', 'Name')).toBe('');
  expect(readInput([{ name: 'workcenter', value: 'Line 1' }], 'WorkCenter', 'Name')).toBe('Line 1');
  expect(readInput([{ name: 'X', value: '[not json' }], 'X', 'Y')).toBe('[not json');
});

test('readStartingParameters: library shape {Value} unwraps; any other list passes through', () => {
  expect(readStartingParameters([{ name: 'StartingParameters', value: list({ Value: 'Batch=B-1' }) }])).toBe('Batch=B-1');
  const params = list({ Batch: 'B-1', Qty: '4' });
  expect(readStartingParameters([{ name: 'StartingParameters', value: params }])).toBe(params);
  expect(readStartingParameters([{ name: 'StartingParameters', value: 'Batch=B-1' }])).toBe('Batch=B-1');
});

test('group and completionOutputs use the Value Type list form', () => {
  expect(JSON.parse(group({ ID: 'x', Label: 'RW-1' }))).toEqual([{ name: 'ID', value: 'x' }, { name: 'Label', value: 'RW-1' }]);
  expect(completionOutputs(3, 'nope')).toEqual([
    { name: 'Completion', value: group({ Code: '3' }) },
    { name: 'Error', value: group({ Text: 'nope' }) },
  ]);
});

test('catalog: ten actions, own oid first, then name', () => {
  expect(ACTIONS).toHaveLength(10);
  expect(BROKER_ENV.name).toBe('Distributed Workflow Management');
  expect(findAction('broker-wait', null)?.key).toBe('wait');
  expect(findAction('designer-uuid', 'Create and Start Runtime Workflow')?.key).toBe('createStart');
  expect(findAction('designer-uuid', 'get runtime workflow status')?.key).toBe('status');
  expect(findAction('designer-uuid', 'Nope')).toBeNull();
});
