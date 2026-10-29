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
// No properties.test.ts exists in the reference repo (engines/web/src) — this suite is
// written per task-7-brief.md Step 1's required-coverage list, plus the toJSON/fromJSON
// round-trip the brief's adaptation table adds beyond the reference PropertyStore.
import { expect, test } from 'vitest';
import { PropertyStore, resolveDefaultValue } from '../src/core/properties.js';
import type { MasterWorkflowSpecification, ParameterSpecification } from '../src/spec/types.js';

// ── initializeFromWorkflow / initializeFromSetup / initializeStartingParameters ──

test('initializeFromWorkflow seeds dotted keys from value_property_specifications', () => {
  const store = new PropertyStore();
  const workflow = {
    value_property_specifications: [
      { name: 'DataToSend', entries: [{ name: 'X', value: '1' }, { name: 'Y', value: '2' }] },
    ],
  } as unknown as MasterWorkflowSpecification;
  store.initializeFromWorkflow(workflow);
  expect(store.get('DataToSend.X')).toBe('1');
  expect(store.get('DataToSend.Y')).toBe('2');
});

test('initializeFromWorkflow is a no-op when value_property_specifications is absent', () => {
  const store = new PropertyStore();
  store.initializeFromWorkflow({} as unknown as MasterWorkflowSpecification);
  expect(store.toFlatMap()).toEqual({});
});

test('initializeFromSetup seeds bare keys from a flat record', () => {
  const store = new PropertyStore();
  store.initializeFromSetup({ Foo: 'bar', 'Group.X': '1' });
  expect(store.get('Foo')).toBe('bar');
  expect(store.get('Group.X')).toBe('1');
});

test('initializeStartingParameters: caller-supplied value takes precedence over spec default', () => {
  const store = new PropertyStore();
  const specs: ParameterSpecification[] = [{ id: 'p1', default_value: 'defaultVal' }];
  store.initializeStartingParameters(specs, { p1: 'callerVal' });
  expect(store.get('p1')).toBe('callerVal');
  expect(store.getInputParameters()).toEqual({ p1: 'callerVal' });
});

test('initializeStartingParameters: no caller value falls back to literal default_value', () => {
  const store = new PropertyStore();
  const specs: ParameterSpecification[] = [{ id: 'p1', default_value: 'literalDefault' }];
  store.initializeStartingParameters(specs, undefined);
  expect(store.get('p1')).toBe('literalDefault');
});

test('initializeStartingParameters: value_type "property" resolves default_value through the store', () => {
  const store = new PropertyStore();
  store.initializeFromSetup({ SourceProp: 'resolvedFromProperty' });
  const specs: ParameterSpecification[] = [
    { id: 'p1', default_value: 'SourceProp', value_type: 'property' },
  ];
  store.initializeStartingParameters(specs, undefined);
  expect(store.get('p1')).toBe('resolvedFromProperty');
});

test('initializeStartingParameters is a no-op when specs is undefined', () => {
  const store = new PropertyStore();
  store.initializeStartingParameters(undefined, { p1: 'x' });
  expect(store.get('p1')).toBeUndefined();
});

// ── resolveInputParameters / getInputParameters ──

test('resolveInputParameters resolves literal and property-mode defaults into inputParameters', () => {
  const store = new PropertyStore();
  store.initializeFromSetup({ SourceProp: 'fromProp' });
  const specs: ParameterSpecification[] = [
    { id: 'lit', default_value: 'literal' },
    { id: 'prop', default_value: 'SourceProp', value_type: 'property' },
  ];
  store.resolveInputParameters(specs);
  expect(store.getInputParameters()).toEqual({ lit: 'literal', prop: 'fromProp' });
});

test('getInputParameters falls back to startingParameters for keys resolveInputParameters did not set', () => {
  const store = new PropertyStore();
  store.initializeStartingParameters([{ id: 'sp', default_value: 'startingVal' }], undefined);
  store.resolveInputParameters([{ id: 'ip', default_value: 'inputVal' }]);
  expect(store.getInputParameters()).toEqual({ ip: 'inputVal', sp: 'startingVal' });
});

test('resolveInputParameters clears any prior inputParameters before re-populating', () => {
  const store = new PropertyStore();
  store.resolveInputParameters([{ id: 'a', default_value: '1' }]);
  store.resolveInputParameters([{ id: 'b', default_value: '2' }]);
  expect(store.getInputParameters()).toEqual({ b: '2' });
});

test('resolveInputParameters(undefined) clears a previous step\'s resolved inputs (a step with no specs has no inputs — spec 2026-09-04 D9 review finding)', () => {
  const store = new PropertyStore();
  store.resolveInputParameters([{ id: 'level', default_value: '150', value_type: 'literal' }]);
  store.resolveInputParameters(undefined);
  expect(store.getInputParameters()).toEqual({});
});

// ── resolveKey (exact match + group-prefix fallback, Description excluded) ──

test('resolveKey returns the exact value when the key is present', () => {
  const store = new PropertyStore();
  store.set('Foo', 'bar');
  expect(store.resolveKey('Foo')).toBe('bar');
});

test('resolveKey falls back to group-prefix serialization when the bare key is absent', () => {
  const store = new PropertyStore();
  store.set('DataToSend.X', '1');
  store.set('DataToSend.Y', '2');
  const result = JSON.parse(store.resolveKey('DataToSend'));
  expect(result).toEqual(expect.arrayContaining([
    { name: 'X', value: '1' },
    { name: 'Y', value: '2' },
  ]));
  expect(result).toHaveLength(2);
});

test('resolveKey group-prefix fallback excludes a Description entry (case-insensitive)', () => {
  const store = new PropertyStore();
  store.set('Group.X', '1');
  store.set('Group.Description', 'human readable note');
  store.set('Group2.Y', '2');
  store.set('Group2.description', 'lowercase variant');
  expect(JSON.parse(store.resolveKey('Group'))).toEqual([{ name: 'X', value: '1' }]);
  expect(JSON.parse(store.resolveKey('Group2'))).toEqual([{ name: 'Y', value: '2' }]);
});

test('resolveKey returns empty string when neither exact key nor group prefix matches', () => {
  const store = new PropertyStore();
  expect(store.resolveKey('Missing')).toBe('');
});

// ── setSyncTarget (group explosion) ──

test('setSyncTarget sets the bare target and explodes a JSON [{name,value}] array into dotted children', () => {
  const store = new PropertyStore();
  store.setSyncTarget('Incoming', JSON.stringify([{ name: 'A', value: '10' }, { name: 'B', value: '20' }]));
  expect(store.get('Incoming')).toBe(JSON.stringify([{ name: 'A', value: '10' }, { name: 'B', value: '20' }]));
  expect(store.get('Incoming.A')).toBe('10');
  expect(store.get('Incoming.B')).toBe('20');
});

test('setSyncTarget with a non-JSON-array payload only sets the bare target', () => {
  const store = new PropertyStore();
  store.setSyncTarget('Incoming', 'plain string value');
  expect(store.get('Incoming')).toBe('plain string value');
  expect(store.get('Incoming.A')).toBeUndefined();
});

// ── resolveDefault (instance method) + resolveDefaultValue (pure function) ──

test('resolveDefault handles static/property/parameter/input modes', () => {
  const store = new PropertyStore();
  store.set('Prop1', 'propVal');
  store.resolveInputParameters([{ id: 'In1', default_value: 'inputVal' }]);
  expect(store.resolveDefault({ mode: 'static', value: 'staticVal' })).toBe('staticVal');
  expect(store.resolveDefault({ mode: 'property', value: 'Prop1' })).toBe('propVal');
  expect(store.resolveDefault({ mode: 'parameter', value: 'Prop1' })).toBe('propVal');
  expect(store.resolveDefault({ mode: 'input', value: 'In1' })).toBe('inputVal');
  expect(store.resolveDefault(undefined)).toBe('');
});

test('resolveDefaultValue (pure function) mirrors resolveDefault against flat maps', () => {
  const properties = { Prop1: 'propVal' };
  const inputParameters = { In1: 'inputVal' };
  expect(resolveDefaultValue({ mode: 'static', value: 'staticVal' }, properties, inputParameters)).toBe('staticVal');
  expect(resolveDefaultValue({ mode: 'property', value: 'Prop1' }, properties, inputParameters)).toBe('propVal');
  expect(resolveDefaultValue({ mode: 'input', value: 'In1' }, properties, inputParameters)).toBe('inputVal');
  expect(resolveDefaultValue({ mode: 'input', value: 'Missing' }, properties, inputParameters)).toBe('');
  expect(resolveDefaultValue(undefined, properties, inputParameters)).toBe('');
});

// ── captureFormOutputs (spec.target else el.outputParameter) ──

test('captureFormOutputs prefers output_parameter_specifications target over the raw outputParameter', () => {
  const store = new PropertyStore();
  const elements = [
    { type: 'textInput', x: 0, y: 0, width: 1, height: 1, fieldName: 'f1', outputParameter: 'Bound' },
  ] as any;
  store.captureFormOutputs(elements, { f1: 'value1' }, [{ id: 'Bound', target: 'Resolved.Target' }]);
  expect(store.get('Resolved.Target')).toBe('value1');
  expect(store.get('Bound')).toBeUndefined();
});

test('captureFormOutputs falls back to el.outputParameter when no matching spec target exists', () => {
  const store = new PropertyStore();
  const elements = [
    { type: 'textInput', x: 0, y: 0, width: 1, height: 1, fieldName: 'f1', outputParameter: 'Direct.Key' },
  ] as any;
  store.captureFormOutputs(elements, { f1: 'value1' });
  expect(store.get('Direct.Key')).toBe('value1');
});

test('captureFormOutputs skips elements without outputParameter or fieldName, and undefined form values', () => {
  const store = new PropertyStore();
  const elements = [
    { type: 'header', x: 0, y: 0, width: 1, height: 1, content: { content: '', plainText: '' } },
    { type: 'textInput', x: 0, y: 0, width: 1, height: 1, fieldName: 'missing', outputParameter: 'Should.NotSet' },
  ] as any;
  store.captureFormOutputs(elements, {});
  expect(store.get('Should.NotSet')).toBeUndefined();
});

test('captureFormOutputs JSON-stringifies array values', () => {
  const store = new PropertyStore();
  const elements = [
    { type: 'checkbox', x: 0, y: 0, width: 1, height: 1, fieldName: 'f1', outputParameter: 'Checked' },
  ] as any;
  store.captureFormOutputs(elements, { f1: ['a', 'b'] });
  expect(store.get('Checked')).toBe(JSON.stringify(['a', 'b']));
});

// ── toJSON / fromJSON round-trip (engine adaptation beyond the reference) ──

test('toJSON/fromJSON round-trips the bare property store', () => {
  const store = new PropertyStore();
  store.set('Foo', 'bar');
  store.set('Group.X', '1');
  const json = store.toJSON();
  expect(json).toEqual({ Foo: 'bar', 'Group.X': '1' });

  const rehydrated = PropertyStore.fromJSON(json);
  expect(rehydrated.get('Foo')).toBe('bar');
  expect(rehydrated.get('Group.X')).toBe('1');
  expect(rehydrated.toFlatMap()).toEqual(json);
});

test('fromJSON does not carry over startingParameters/inputParameters (not part of the persisted shape)', () => {
  const rehydrated = PropertyStore.fromJSON({ Foo: 'bar' });
  expect(rehydrated.getInputParameters()).toEqual({});
});

// ── applyInputOverlay (spec 2026-09-04 D3) ──

test('applyInputOverlay replaces resolved input values by id and never touches the store', () => {
  const store = new PropertyStore();
  store.initializeFromSetup({ 'Sensor.Value': 'stale' });
  store.resolveInputParameters([
    { id: 'f', default_value: 'Sensor.Value', value_type: 'property' },
    { id: 'g', default_value: 'lit', value_type: 'literal' },
  ]);
  store.applyInputOverlay({ f: 'live' });
  expect(store.getInputParameters()).toEqual({ f: 'live', g: 'lit' });
  expect(store.get('Sensor.Value')).toBe('stale');
  expect(store.toFlatMap()).toEqual({ 'Sensor.Value': 'stale' });
});
