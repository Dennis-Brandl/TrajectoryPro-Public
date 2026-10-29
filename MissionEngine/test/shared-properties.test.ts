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
import { PropertyStore } from '../src/core/properties.js';
import { SharedPropertyTier } from '../src/core/shared-properties.js';
import type { MasterWorkflowSpecification } from '../src/spec/types.js';

const tier = () => SharedPropertyTier.fromRows([
  { propertyName: 'Recipe', entryName: 'Target', value: '80' },
  { propertyName: 'Recipe', entryName: 'Tolerance', value: '2' },
  { propertyName: 'Recipe', entryName: 'Description', value: 'fill parameters' },
  { propertyName: 'Line', entryName: 'Speed', value: '10' },
]);

const spec = (values: Array<{ name: string; entries: Array<{ name: string; value: string }> }>): MasterWorkflowSpecification =>
  ({ oid: 'wf', local_id: 'WF', steps: [], connections: [], value_property_specifications: values } as unknown as MasterWorkflowSpecification);

function store(declared: Parameters<typeof spec>[0] = []) {
  const s = new PropertyStore();
  s.attachShared(tier());
  s.bindDeclaredNames(spec(declared));
  return s;
}

test('a shared value is readable when the workflow declares nothing', () => {
  const s = store();
  expect(s.get('Recipe.Target')).toBe('80');
  expect(s.resolveKey('Recipe.Target')).toBe('80');
});

test('an undeclared, unshared key still resolves to empty string', () => {
  const s = store();
  expect(s.resolveKey('Nope.Nothing')).toBe('');
});

test('a local value shadows the shared one for the same key', () => {
  const s = store([{ name: 'Recipe', entries: [{ name: 'Target', value: '5' }] }]);
  s.initializeFromWorkflow(spec([{ name: 'Recipe', entries: [{ name: 'Target', value: '5' }] }]));
  expect(s.get('Recipe.Target')).toBe('5');
  // The shared entry the workflow does NOT declare still resolves through.
  expect(s.get('Recipe.Tolerance')).toBe('2');
});

test('a group read merges both tiers, local winning per entry, Description excluded', () => {
  const s = store([{ name: 'Recipe', entries: [{ name: 'Target', value: '5' }] }]);
  s.initializeFromWorkflow(spec([{ name: 'Recipe', entries: [{ name: 'Target', value: '5' }] }]));
  const merged = JSON.parse(s.resolveKey('Recipe')) as Array<{ name: string; value: string }>;
  const byName = Object.fromEntries(merged.map((e) => [e.name, e.value]));
  expect(byName).toEqual({ Target: '5', Tolerance: '2' });
  expect(merged.some((e) => e.name === 'Description')).toBe(false);
});

test('a group read of a purely shared property works', () => {
  const s = store();
  const merged = JSON.parse(s.resolveKey('Line')) as Array<{ name: string; value: string }>;
  expect(merged).toEqual([{ name: 'Speed', value: '10' }]);
});

test('writing a workflow-declared name stays LOCAL and never dirties the tier', () => {
  const declared = [{ name: 'Recipe', entries: [{ name: 'Target', value: '5' }] }];
  const s = store(declared);
  s.initializeFromWorkflow(spec(declared));
  s.set('Recipe.Target', '7');
  expect(s.get('Recipe.Target')).toBe('7');
  expect(s.toJSON()['Recipe.Target']).toBe('7');
  expect(s.sharedTier()!.takeDirty()).toEqual([]);
});

test('I1 fix: a local entry for a key the tier also holds stays LOCAL when written, even though the workflow never declared it', () => {
  const s = store(); // no declaration — declaredLocally is empty
  // Seeds a LOCAL entry directly, bypassing declaredLocally entirely — mirrors the two real
  // paths that do this: initializeFromSetup (child seeding, transition.ts's WORKFLOW PROXY
  // activation) and PropertyStore.fromJSON (the per-transition hydrate).
  s.initializeFromSetup({ 'Recipe.Target': '5' });
  s.set('Recipe.Target', '9');
  // The writer reads back its OWN write, not a stale value from a misrouted shared write.
  expect(s.get('Recipe.Target')).toBe('9');
  expect(s.toJSON()['Recipe.Target']).toBe('9');
  // Never touched the shared tier — no other workflow in the work center should ever see this.
  expect(s.sharedTier()!.takeDirty()).toEqual([]);
});

test('writing an exact registry pair the workflow does not declare goes SHARED', () => {
  const s = store();
  s.set('Recipe.Target', '95');
  expect(s.get('Recipe.Target')).toBe('95');
  // Never mirrored locally — that would pin this instance to its own copy forever.
  expect(s.toJSON()['Recipe.Target']).toBeUndefined();
  expect(s.sharedTier()!.takeDirty()).toEqual([
    { propertyName: 'Recipe', entryName: 'Target', value: '95' },
  ]);
});

test('writing a property the registry knows but an ENTRY it does not stays local (delta D5)', () => {
  const s = store();
  s.set('Recipe.BrandNew', 'x');
  expect(s.toJSON()['Recipe.BrandNew']).toBe('x');
  expect(s.sharedTier()!.takeDirty()).toEqual([]);
});

test('takeDirty drains, so a second flush writes nothing', () => {
  const s = store();
  s.set('Recipe.Target', '95');
  expect(s.sharedTier()!.takeDirty()).toHaveLength(1);
  expect(s.sharedTier()!.takeDirty()).toEqual([]);
});

test('toJSON and toFlatMap are LOCAL-ONLY — the trap this design exists to avoid', () => {
  const s = store();
  expect(s.get('Recipe.Target')).toBe('80');   // readable
  expect(s.toJSON()).toEqual({});               // but never serialized
  expect(s.toFlatMap()).toEqual({});
});

test('toHistoryJSON merges shared under local (delta D6)', () => {
  const declared = [{ name: 'Recipe', entries: [{ name: 'Target', value: '5' }] }];
  const s = store(declared);
  s.initializeFromWorkflow(spec(declared));
  const h = s.toHistoryJSON();
  expect(h['Recipe.Target']).toBe('5');       // local wins
  expect(h['Line.Speed']).toBe('10');         // shared still recorded
});

test('with no tier attached, behavior is exactly as before', () => {
  const s = new PropertyStore();
  s.bindDeclaredNames(spec([]));
  s.set('Anything.Goes', 'v');
  expect(s.get('Anything.Goes')).toBe('v');
  expect(s.toJSON()).toEqual({ 'Anything.Goes': 'v' });
  expect(s.resolveKey('Missing.Key')).toBe('');
});

test('two stores sharing one tier observe each other writes', () => {
  const shared = tier();
  const a = new PropertyStore(); a.attachShared(shared); a.bindDeclaredNames(spec([]));
  const b = new PropertyStore(); b.attachShared(shared); b.bindDeclaredNames(spec([]));
  a.set('Recipe.Target', '42');
  expect(b.get('Recipe.Target')).toBe('42');
});

// ── setSyncTarget / captureFormOutputs must route through set(), not bypass it ──

test('setSyncTarget: a bare target that is not an exact registry pair stays local', () => {
  const s = store();
  s.setSyncTarget('Incoming', 'plain string value');
  expect(s.get('Incoming')).toBe('plain string value');
  expect(s.toJSON()['Incoming']).toBe('plain string value');
  expect(s.sharedTier()!.takeDirty()).toEqual([]);
});

test('setSyncTarget: an exploded child that IS an exact registry pair routes shared; the bare target stays local', () => {
  const s = store();
  s.setSyncTarget('Recipe', JSON.stringify([{ name: 'Target', value: '99' }]));
  // Bare "Recipe" is never itself a registry pair (registry keys are always "Prop.Entry") — stays local.
  expect(s.toJSON()['Recipe']).toBe(JSON.stringify([{ name: 'Target', value: '99' }]));
  // The exploded child "Recipe.Target" IS an exact registry pair — routes shared, never mirrored locally.
  expect(s.get('Recipe.Target')).toBe('99');
  expect(s.toJSON()['Recipe.Target']).toBeUndefined();
  expect(s.sharedTier()!.takeDirty()).toEqual([
    { propertyName: 'Recipe', entryName: 'Target', value: '99' },
  ]);
});

test('captureFormOutputs: an exact registry pair target routes shared, never mirrored locally', () => {
  const s = store();
  const elements = [
    { type: 'textInput', x: 0, y: 0, width: 1, height: 1, fieldName: 'f1', outputParameter: 'Recipe.Target' },
  ] as any;
  s.captureFormOutputs(elements, { f1: '77' });
  expect(s.get('Recipe.Target')).toBe('77');
  expect(s.toJSON()['Recipe.Target']).toBeUndefined();
  expect(s.sharedTier()!.takeDirty()).toEqual([
    { propertyName: 'Recipe', entryName: 'Target', value: '77' },
  ]);
});

test('captureFormOutputs: a workflow-declared name stays local and never dirties the tier', () => {
  const s = store([{ name: 'Recipe', entries: [] }]);
  const elements = [
    { type: 'textInput', x: 0, y: 0, width: 1, height: 1, fieldName: 'f1', outputParameter: 'Recipe.Target' },
  ] as any;
  s.captureFormOutputs(elements, { f1: '55' });
  expect(s.get('Recipe.Target')).toBe('55');
  expect(s.toJSON()['Recipe.Target']).toBe('55');
  expect(s.sharedTier()!.takeDirty()).toEqual([]);
});
