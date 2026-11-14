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
// FormKit spec X.3 (user ruling 2026-11-14): property/input-sourced form defaults and
// placeholders are resolved by the engine at step activation.
import { expect, test } from 'vitest';
import { PropertyStore } from '../src/core/properties.js';
import { resolveFormSources } from '../src/core/form-sources.js';
import type { MasterWorkflowStep } from '../src/spec/types.js';

function stepWith(blocks: Array<Record<string, unknown>>): MasterWorkflowStep {
  return {
    oid: 'st1',
    form_document: { version: 2, sections: [{ id: 's1', role: 'content', rows: [{ id: 'r1', blocks }] }] },
  } as unknown as MasterWorkflowStep;
}

function store(): PropertyStore {
  const s = new PropertyStore();
  s.set('Batch.Lot', 'L-7');
  s.resolveInputParameters([{ id: 'Operator', value_type: 'static', default_value: 'Ada' } as never]);
  return s;
}

test('resolves property and input defaults and every placeholderSource, by block id', () => {
  const step = stepWith([
    { id: 'a', type: 'textInput', fieldName: 'lot', defaultSource: { mode: 'property', value: 'Batch.Lot' } },
    { id: 'b', type: 'textInput', fieldName: 'who', defaultSource: { mode: 'input', value: 'Operator' } },
    { id: 'c', type: 'textarea', fieldName: 'n', placeholderSource: { mode: 'input', value: 'Operator' } },
    { id: 'd', type: 'textInput', fieldName: 'p', placeholderSource: { mode: 'static', value: 'Type here' } },
    { id: 'e', type: 'textInput', fieldName: 's', defaultSource: { mode: 'static', value: 'keep' } },
  ]);
  expect(resolveFormSources(step, store())).toEqual({
    defaults: { a: 'L-7', b: 'Ada' },
    placeholders: { c: 'Ada', d: 'Type here' },
  });
});

test('unresolvable sources are left out; a form with nothing to resolve gives undefined', () => {
  const step = stepWith([
    { id: 'a', type: 'textInput', fieldName: 'x', defaultSource: { mode: 'property', value: 'Nope' } },
    { id: 'b', type: 'textInput', fieldName: 'y', defaultSource: { mode: 'static', value: 'v' } },
    { id: 'c', type: 'textInput', fieldName: 'z', defaultSource: { mode: 'weird', value: 'v' } },
  ]);
  expect(resolveFormSources(step, store())).toBeUndefined();
  expect(resolveFormSources({ oid: 'x' } as unknown as MasterWorkflowStep, store())).toBeUndefined();
});
