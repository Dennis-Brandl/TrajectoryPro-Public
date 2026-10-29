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
import { workflowOutputs } from './workflow-outputs.js';

test('reads each workflow output from its target, falling back to its id, then empty', () => {
  const spec = { output_parameter_specifications: [
    { id: 'Batch', target: 'Result.Batch' },
    { id: 'Qty' },
    { id: 'Missing', target: 'Nope' },
    { junk: true },
  ] };
  expect(workflowOutputs(spec, { 'Result.Batch': 'B-1', Qty: '40' })).toEqual([
    { name: 'Batch', value: 'B-1' }, { name: 'Qty', value: '40' }, { name: 'Missing', value: '' },
  ]);
});

test('no output specs, or no spec at all, gives an empty list', () => {
  expect(workflowOutputs({}, {})).toEqual([]);
  expect(workflowOutputs(null, {})).toEqual([]);
});

test('a target naming a whole Value Property with only dotted entries reads them as the engine resolves a whole-property key', () => {
  const spec = { output_parameter_specifications: [{ id: 'Result', target: 'Batch' }, { id: 'Exact', target: 'Lot' }] };
  const props = {
    'Batch.Description': 'human note', 'Batch.description': 'also skipped', 'Batch.Yield': '97', 'Batch.Grade.Code': 'A',
    'Batchy.Other': 'not under Batch', Lot: 'L-1', 'Lot.Yield': 'ignored: the exact key wins',
  };
  const [result, exact] = workflowOutputs(spec, props);
  expect(JSON.parse(result.value)).toEqual([{ name: 'Yield', value: '97' }, { name: 'Grade.Code', value: 'A' }]);
  expect(result.value).toBe(JSON.stringify([{ name: 'Yield', value: '97' }, { name: 'Grade.Code', value: 'A' }]));
  expect(exact).toEqual({ name: 'Exact', value: 'L-1' });
  // Only Description under the property: nothing to report.
  expect(workflowOutputs({ output_parameter_specifications: [{ id: 'X', target: 'P' }] }, { 'P.Description': 'd' }))
    .toEqual([{ name: 'X', value: '' }]);
});
