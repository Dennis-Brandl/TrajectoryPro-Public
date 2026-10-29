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
// handleUserAction tests below are transcribed from the reference repo's
// engines/web/src/step-handlers.test.ts (node:test/node:assert -> vitest), adapted per
// task-7-brief.md's "adapting imports" instruction. handleSelect1 and executeScript tests
// are new, per the brief Step 1 required-coverage list (the reference has no such tests).
import { expect, test } from 'vitest';
import { handleSelect1, handleUserAction, needsUserAction, executeScript, executeGateScript, gateCycleSeconds, runRepeatingScript, commitScriptOutputs, nextScriptWake, scriptExpired, scriptLimitDeadline, scriptCycleSeconds, scriptOnTimeLimit, scriptErrorMessage, SCRIPT_UNREADABLE_ERROR, readSandboxEnvelope, isSandboxPromise } from '../src/core/step-handlers.js';
import * as vm from 'node:vm';
import { PropertyStore } from '../src/core/properties.js';
import type { MasterWorkflowStep, UserAction } from '../src/spec/types.js';

// ── handleUserAction (transcribed from the reference) ──

test('handleUserAction: captures form outputs on button_press for USER_INTERACTION', () => {
  const step = {
    oid: 's1',
    step_type: 'USER_INTERACTION',
    description: 'Test',
    form_layout_config: [{
      deviceType: 'phone',
      canvasWidth: 390,
      canvasHeight: 844,
      elements: [
        {
          type: 'textInput',
          x: 0, y: 0, width: 300, height: 40,
          fieldName: 'name',
          label: 'Name',
          outputParameter: 'Response.Name',
        },
        {
          type: 'button',
          x: 0, y: 60, width: 300, height: 40,
          label: 'Continue',
          outputValue: 'continue',
        },
      ],
    }],
  } as unknown as MasterWorkflowStep;

  const store = new PropertyStore();
  const action: UserAction = {
    step_oid: 's1',
    action: 'button_press',
    button_output: 'continue',
    form_values: { name: 'Alice' },
  };

  const result = handleUserAction(step, action, store);
  expect(store.get('Response.Name')).toBe('Alice');
  expect(result).toEqual({ conditionValue: 'continue' });
});

test('handleUserAction: YES_NO is routing-only, button_output never writes to output_parameter_specifications', () => {
  const step = {
    oid: 's1',
    step_type: 'YES_NO',
    description: 'Confirm?',
    yes_no_config: {
      yes_label: 'Yes', no_label: 'No',
      yes_value: 'true', no_value: 'false',
    },
    output_parameter_specifications: [
      { id: 'answer', target: 'Response.Answer' },
    ],
  } as unknown as MasterWorkflowStep;

  const store = new PropertyStore();
  const action: UserAction = {
    step_oid: 's1',
    action: 'button_press',
    button_output: 'true',
  };

  const result = handleUserAction(step, action, store);
  expect(store.get('Response.Answer')).toBeUndefined();
  expect(result).toEqual({ conditionValue: 'true', sourceHandleId: 'true', excludeUnconditional: true });
});

test('handleUserAction: YES_NO "no" press returns sourceHandleId matching outputValue', () => {
  const step = {
    oid: 's1',
    step_type: 'YES_NO',
    description: 'Confirm?',
    yes_no_config: {
      yes_label: 'Yes', no_label: 'No',
      yes_value: 'true', no_value: 'false',
    },
  } as unknown as MasterWorkflowStep;

  const store = new PropertyStore();
  const action: UserAction = {
    step_oid: 's1',
    action: 'button_press',
    button_output: 'false',
  };

  const result = handleUserAction(step, action, store);
  expect(result).toEqual({ conditionValue: 'false', sourceHandleId: 'false', excludeUnconditional: true });
});

test('handleUserAction: YES_NO with custom values uses outputValue as sourceHandleId', () => {
  const step = {
    oid: 's1',
    step_type: 'YES_NO',
    description: 'Approve?',
    yes_no_config: {
      yes_label: 'Approve', no_label: 'Reject',
      yes_value: 'approved', no_value: 'rejected',
    },
  } as unknown as MasterWorkflowStep;

  const store = new PropertyStore();
  const yesResult = handleUserAction(step, { step_oid: 's1', action: 'button_press', button_output: 'approved' }, store);
  expect(yesResult.sourceHandleId).toBe('approved');

  const noResult = handleUserAction(step, { step_oid: 's1', action: 'button_press', button_output: 'rejected' }, store);
  expect(noResult.sourceHandleId).toBe('rejected');
});

test('handleUserAction: YES_NO with form-bound outputs — form values land in their targets, button_output does not clobber them', () => {
  const step = {
    oid: 's1',
    step_type: 'YES_NO',
    description: 'Select Paths',
    yes_no_config: {
      yes_label: 'Yes', no_label: 'No',
      yes_value: 'true', no_value: 'false',
    },
    output_parameter_specifications: [
      { id: 'PathPicked', target: 'PathPicked' },
      { id: 'GlobalPathPicked', target: 'GlobalPathPicked.Value' },
    ],
    form_layout_config: [{
      deviceType: 'phone',
      canvasWidth: 360,
      canvasHeight: 850,
      elements: [
        {
          type: 'textInput',
          x: 0, y: 0, width: 300, height: 60,
          fieldName: 'Text_810880',
          label: 'Local Path',
          outputParameter: 'PathPicked',
        },
        {
          type: 'textInput',
          x: 0, y: 80, width: 300, height: 60,
          fieldName: 'Text_742912',
          label: 'Global Path',
          outputParameter: 'GlobalPathPicked',
        },
        { type: 'button', x: 0, y: 600, width: 120, height: 40, label: 'Yes', outputValue: 'true' },
        { type: 'button', x: 150, y: 600, width: 120, height: 40, label: 'No', outputValue: 'false' },
      ],
    }],
  } as unknown as MasterWorkflowStep;

  const store = new PropertyStore();
  const action: UserAction = {
    step_oid: 's1',
    action: 'button_press',
    button_output: 'true',
    form_values: { Text_810880: '0', Text_742912: '1' },
  };

  const result = handleUserAction(step, action, store);

  expect(store.get('PathPicked')).toBe('0');
  expect(store.get('GlobalPathPicked.Value')).toBe('1');
  expect(result).toEqual({ conditionValue: 'true', sourceHandleId: 'true', excludeUnconditional: true });
});

test('handleUserAction: needsUserAction includes ACTION PROXY', () => {
  expect(needsUserAction('ACTION PROXY')).toBe(true);
});

test('handleUserAction: YES_NO with bound + unbound specs — form value lands in its target, unbound specs stay untouched', () => {
  const step = {
    oid: 's1',
    step_type: 'YES_NO',
    description: 'Confirm with note',
    yes_no_config: { yes_label: 'Yes', no_label: 'No', yes_value: 'true', no_value: 'false' },
    output_parameter_specifications: [
      { id: 'Note', target: 'Response.Note' },
      { id: 'Answer', target: 'Response.Answer' },
    ],
    form_layout_config: [{
      deviceType: 'phone',
      canvasWidth: 360,
      canvasHeight: 850,
      elements: [
        {
          type: 'textInput',
          x: 0, y: 0, width: 300, height: 60,
          fieldName: 'note',
          label: 'Note',
          outputParameter: 'Note',
        },
      ],
    }],
  } as unknown as MasterWorkflowStep;

  const store = new PropertyStore();
  const action: UserAction = {
    step_oid: 's1',
    action: 'button_press',
    button_output: 'false',
    form_values: { note: 'looked fine' },
  };

  handleUserAction(step, action, store);

  expect(store.get('Response.Note')).toBe('looked fine');
  expect(store.get('Response.Answer')).toBeUndefined();
});

test('handleUserAction: still captures form outputs on submit for USER_INTERACTION', () => {
  const step = {
    oid: 's1',
    step_type: 'USER_INTERACTION',
    description: 'Test',
    form_layout_config: [{
      deviceType: 'phone',
      canvasWidth: 390,
      canvasHeight: 844,
      elements: [
        {
          type: 'textInput',
          x: 0, y: 0, width: 300, height: 40,
          fieldName: 'email',
          label: 'Email',
          outputParameter: 'Contact.Email',
        },
      ],
    }],
  } as unknown as MasterWorkflowStep;

  const store = new PropertyStore();
  const action: UserAction = {
    step_oid: 's1',
    action: 'submit',
    form_values: { email: 'test@example.com' },
  };

  const result = handleUserAction(step, action, store);
  expect(store.get('Contact.Email')).toBe('test@example.com');
  expect(result).toEqual({});
});

// ── handleSelect1 (new — the reference has no unit tests for this) ──

function select1Step(inputValue: string, options: Array<Record<string, unknown>>): MasterWorkflowStep {
  return {
    oid: 's1',
    step_type: 'SELECT_1',
    description: 'Select 1',
    select1_config: {
      input_name: inputValue,
      input_value_type: 'literal',
      options,
    },
  } as unknown as MasterWorkflowStep;
}

test('handleSelect1: returns {} when select1_config or options is absent', () => {
  const store = new PropertyStore();
  expect(handleSelect1({ oid: 's1', step_type: 'SELECT_1', description: 'x' } as unknown as MasterWorkflowStep, store)).toEqual({});
  expect(handleSelect1({ oid: 's1', step_type: 'SELECT_1', description: 'x', select1_config: {} } as unknown as MasterWorkflowStep, store)).toEqual({});
});

const OPERATOR_CASES: Array<{ operator: string; input: string; value: string; matches: boolean }> = [
  { operator: '==', input: 'abc', value: 'abc', matches: true },
  { operator: '==', input: 'abc', value: 'xyz', matches: false },
  { operator: '!=', input: 'abc', value: 'xyz', matches: true },
  { operator: '!=', input: 'abc', value: 'abc', matches: false },
  // Lexicographic (string) comparison, bug-for-bug with the reference: '9' > '10' is true.
  { operator: '<', input: '9', value: '10', matches: false },
  { operator: '<', input: '10', value: '9', matches: true },
  { operator: '>', input: '9', value: '10', matches: true },
  { operator: '>', input: '10', value: '9', matches: false },
  { operator: '<=', input: 'abc', value: 'abc', matches: true },
  { operator: '<=', input: 'abd', value: 'abc', matches: false },
  { operator: '>=', input: 'abc', value: 'abc', matches: true },
  { operator: '>=', input: 'abb', value: 'abc', matches: false },
  { operator: 'Contains', input: 'hello world', value: 'world', matches: true },
  { operator: 'Contains', input: 'hello world', value: 'xyz', matches: false },
  { operator: 'Not Contains', input: 'hello world', value: 'xyz', matches: true },
  { operator: 'Not Contains', input: 'hello world', value: 'world', matches: false },
];

for (const { operator, input, value, matches } of OPERATOR_CASES) {
  test(`handleSelect1: operator "${operator}" (${input} vs ${value}) => ${matches}`, () => {
    const store = new PropertyStore();
    const step = select1Step(input, [
      { id: 'opt-match', operator, value, value_type: 'literal', is_default: false },
      { id: 'opt-default', operator: '==', value: '__never__', value_type: 'literal', is_default: true },
    ]);
    const result = handleSelect1(step, store);
    expect(result).toEqual(matches ? { connectionId: 'opt-match' } : { connectionId: 'opt-default' });
  });
}

test('handleSelect1: falls back to the default option when no operator matches and no default exists returns {}', () => {
  const store = new PropertyStore();
  const step = select1Step('nope', [
    { id: 'opt1', operator: '==', value: 'a', value_type: 'literal', is_default: false },
  ]);
  expect(handleSelect1(step, store)).toEqual({});
});

test('handleSelect1: resolves input value from a property when input_value_type is "property"', () => {
  const store = new PropertyStore();
  store.set('Status', 'ready');
  const step = {
    oid: 's1',
    step_type: 'SELECT_1',
    description: 'Select 1',
    select1_config: {
      input_name: 'Status',
      input_value_type: 'property',
      options: [
        { id: 'opt1', operator: '==', value: 'ready', value_type: 'literal', is_default: false },
      ],
    },
  } as unknown as MasterWorkflowStep;
  expect(handleSelect1(step, store)).toEqual({ connectionId: 'opt1' });
});

test('handleSelect1: resolves comparison value from a property when option.value_type is "property"', () => {
  const store = new PropertyStore();
  store.set('Threshold', 'abc');
  const step = select1Step('abc', [
    { id: 'opt1', operator: '==', value: 'Threshold', value_type: 'property', is_default: false },
  ]);
  expect(handleSelect1(step, store)).toEqual({ connectionId: 'opt1' });
});

test('handleSelect1: evaluates options in order, first match wins', () => {
  const store = new PropertyStore();
  const step = select1Step('x', [
    { id: 'opt1', operator: '!=', value: 'y', value_type: 'literal', is_default: false },
    { id: 'opt2', operator: '==', value: 'x', value_type: 'literal', is_default: false },
  ]);
  expect(handleSelect1(step, store)).toEqual({ connectionId: 'opt1' });
});

// ── handleSelect1 reads the step's resolved input parameters first (spec 2026-09-04 D9) ──

test('handleSelect1: the compare input and a property-typed option value resolve through the resolved inputs before the store', () => {
  const store = new PropertyStore();
  store.initializeFromSetup({ level: 'store-value', threshold: 'store-threshold' });
  store.resolveInputParameters([
    { id: 'level', default_value: '150', value_type: 'literal' },
    { id: 'threshold', default_value: '150', value_type: 'literal' },
  ]);
  const step = {
    local_id: 'sel', oid: 'sel', version: '1.0.0', last_modified_date: '2026-01-01', step_type: 'SELECT 1',
    select1_config: {
      input_name: 'level', input_value_type: 'property',
      options: [
        { id: 'hi', label: 'High', operator: '==', value: 'threshold', value_type: 'property', is_default: false },
        { id: 'other', label: 'Other', operator: '==', value: '', value_type: 'literal', is_default: true },
      ],
    },
  } as unknown as MasterWorkflowStep;
  expect(handleSelect1(step, store)).toEqual({ connectionId: 'hi' });
});

test('handleSelect1: falls back to the property store when the name is not a resolved input', () => {
  const store = new PropertyStore();
  store.initializeFromSetup({ 'Status.Value': 'open' });
  store.resolveInputParameters([]);
  const step = {
    local_id: 'sel', oid: 'sel', version: '1.0.0', last_modified_date: '2026-01-01', step_type: 'SELECT 1',
    select1_config: {
      input_name: 'Status.Value', input_value_type: 'property',
      options: [{ id: 'open', label: 'Open', operator: '==', value: 'open', value_type: 'literal', is_default: false }],
    },
  } as unknown as MasterWorkflowStep;
  expect(handleSelect1(step, store)).toEqual({ connectionId: 'open' });
});

test('handleSelect1: a previous step\'s resolved input does not leak into a step with no input specs of its own (stale-carry-over review finding)', () => {
  const store = new PropertyStore();
  store.initializeFromSetup({ level: 'store-value' });
  store.resolveInputParameters([{ id: 'level', default_value: '150', value_type: 'literal' }]);
  store.resolveInputParameters(undefined);
  const step = {
    local_id: 'sel', oid: 'sel', version: '1.0.0', last_modified_date: '2026-01-01', step_type: 'SELECT 1',
    select1_config: {
      input_name: 'level', input_value_type: 'property',
      options: [{ id: 'match', label: 'Match', operator: '==', value: 'store-value', value_type: 'literal', is_default: false }],
    },
  } as unknown as MasterWorkflowStep;
  expect(handleSelect1(step, store)).toEqual({ connectionId: 'match' });
});

// ── executeScript (new — the reference has no unit tests for this) ──

function scriptStep(source: string, outputSpecs?: Array<{ id: string; target?: string }>): MasterWorkflowStep {
  return {
    oid: 's1',
    step_type: 'SCRIPT',
    description: 'Script',
    script_config: { source },
    output_parameter_specifications: outputSpecs,
  } as unknown as MasterWorkflowStep;
}

test('executeScript: happy path with no source passes through', () => {
  const store = new PropertyStore();
  const step = { oid: 's1', step_type: 'SCRIPT', description: 'Script', script_config: {} } as unknown as MasterWorkflowStep;
  expect(executeScript(step, store, {}, 5000)).toEqual({ success: true });
});

test('executeScript: input parameters are injected as named locals, output mapped via output_parameter_specifications target', () => {
  const store = new PropertyStore();
  const step = scriptStep('output.total = Number(a) + Number(b);', [{ id: 'total', target: 'Result.Total' }]);
  const result = executeScript(step, store, { a: '2', b: '3' }, 5000);
  expect(result).toEqual({ success: true });
  expect(store.get('Result.Total')).toBe('5');
});

test('executeScript: without output_parameter_specifications, output keys are written directly as dotted properties', () => {
  const store = new PropertyStore();
  const step = scriptStep('output["Direct.Key"] = "value1"; output.Other = "value2";');
  const result = executeScript(step, store, {}, 5000);
  expect(result).toEqual({ success: true });
  expect(store.get('Direct.Key')).toBe('value1');
  expect(store.get('Other')).toBe('value2');
});

test('executeScript: a spec id not present on output is not written', () => {
  const store = new PropertyStore();
  const step = scriptStep('output.other = "x";', [{ id: 'total', target: 'Result.Total' }]);
  executeScript(step, store, {}, 5000);
  expect(store.get('Result.Total')).toBeUndefined();
});

test('executeScript: returns {success:false, error} when the script throws', () => {
  const store = new PropertyStore();
  const step = scriptStep('throw new Error("boom");');
  const result = executeScript(step, store, {}, 5000);
  expect(result.success).toBe(false);
  // node:vm runs the script in a separate realm, so the thrown Error is not an
  // `instanceof` the calling realm's Error — scriptErrorMessage's `instanceof Error`
  // check (kept verbatim per the brief) therefore falls through to String(err),
  // which yields the "Error: <message>" toString form rather than the bare message.
  expect(result.error).toContain('boom');
});

test('executeScript: a syntax error in the source is caught and reported, not thrown', () => {
  const store = new PropertyStore();
  const step = scriptStep('this is not valid javascript {{{');
  const result = executeScript(step, store, {}, 5000);
  expect(result.success).toBe(false);
  expect(result.error).toBeTruthy();
});

test('executeScript: an infinite-loop script is rejected by the vm timeout within 2x scriptTimeoutMs', () => {
  const store = new PropertyStore();
  const step = scriptStep('while (true) {}');
  const budgetMs = 200;
  const start = Date.now();
  const result = executeScript(step, store, {}, budgetMs);
  const elapsed = Date.now() - start;
  expect(result.success).toBe(false);
  expect(elapsed).toBeLessThan(budgetMs * 2);
});

// ── GATE script contract (Task 3, spec 2026-08-29 §5.4) ──

const gateStep = (config?: Record<string, unknown>): any => ({
  local_id: 'g', oid: 'g', version: '1.0.0', last_modified_date: '2026-01-01',
  step_type: 'GATE', ...(config ? { gate_config: config } : {}),
});

test('gate script RETURNS its verdict — truthy opens', () => {
  expect(executeGateScript(gateStep({ source: 'return Number(t) > 100;' }), { t: '150' }, 5000)).toEqual({ success: true, open: true });
  expect(executeGateScript(gateStep({ source: 'return Number(t) > 100;' }), { t: '50' }, 5000)).toEqual({ success: true, open: false });
});
test('no source = pass-through TRUE (spec §4 optionality)', () => {
  expect(executeGateScript(gateStep(), {}, 5000)).toEqual({ success: true, open: true });
});
test('non-boolean return coerces by JS truthiness', () => {
  expect(executeGateScript(gateStep({ source: 'return "yes";' }), {}, 5000).open).toBe(true);
  expect(executeGateScript(gateStep({ source: 'return 0;' }), {}, 5000).open).toBe(false);
  expect(executeGateScript(gateStep({ source: '/* no return */' }), {}, 5000).open).toBe(false);
});
test('a throwing gate script reports failure, not FALSE (ruling G3)', () => {
  const r = executeGateScript(gateStep({ source: 'throw new Error("boom");' }), {}, 5000);
  expect(r.success).toBe(false);
  expect(r.error).toContain('boom');
});
test('gateCycleSeconds defaults to 5 and floors invalid values to the default', () => {
  expect(gateCycleSeconds(gateStep())).toBe(5);
  expect(gateCycleSeconds(gateStep({ cycle_seconds: 2 }))).toBe(2);
  expect(gateCycleSeconds(gateStep({ cycle_seconds: 0 }))).toBe(5);
});

// ── Repeating SCRIPT (spec 2026-10-13 §6.2/§6.3) ──

function repeatStep(source: string | undefined, repeat: Record<string, unknown> = {}, outputSpecs?: Array<{ id: string; target?: string }>): MasterWorkflowStep {
  return {
    oid: 'sc', step_type: 'SCRIPT', description: 'Repeat',
    script_config: { ...(source !== undefined ? { source } : {}), repeat },
    output_parameter_specifications: outputSpecs,
  } as unknown as MasterWorkflowStep;
}

test('runRepeatingScript: state carries between runs; only `return true` is done', () => {
  const step = repeatStep('state.n = (state.n || 0) + 1; output.n = state.n; return state.n >= 2;');
  const first = runRepeatingScript(step, {}, undefined, 5000);
  expect(first).toEqual({ success: true, done: false, output: { n: '1' }, state: { n: 1 } });
  const second = runRepeatingScript(step, {}, first.state, 5000);
  expect(second).toEqual({ success: true, done: true, output: { n: '2' }, state: { n: 2 } });
  expect(runRepeatingScript(repeatStep('return "yes";'), {}, undefined, 5000).done).toBe(false);
  expect(runRepeatingScript(repeatStep('return 1;'), {}, undefined, 5000).done).toBe(false);
});

test('runRepeatingScript: reassigning state persists', () => {
  const r = runRepeatingScript(repeatStep('state = { reading: Number(level) }; return false;'), { level: '42' }, { old: true }, 5000);
  expect(r.state).toEqual({ reading: 42 });
});

test('runRepeatingScript: inputs are named locals; a previous state object is never mutated in place', () => {
  const previous = { n: 1 };
  const r = runRepeatingScript(repeatStep('state.n += Number(step); return false;'), { step: '2' }, previous, 5000);
  expect(r.state).toEqual({ n: 3 });
  expect(previous).toEqual({ n: 1 });
});

test('runRepeatingScript: oversized or non-JSON state fails the run', () => {
  const big = runRepeatingScript(repeatStep('state.blob = "x".repeat(70000); return false;'), {}, undefined, 5000);
  expect(big).toMatchObject({ success: false, error: 'Script state exceeds 64 KB' });
  const bigint = runRepeatingScript(repeatStep('state.big = 10n; return false;'), {}, undefined, 5000);
  expect(bigint).toMatchObject({ success: false, error: 'Script state is not JSON' });
  const circular = runRepeatingScript(repeatStep('state.self = state; return false;'), {}, undefined, 5000);
  expect(circular).toMatchObject({ success: false, error: 'Script state is not JSON' });
});

test('runRepeatingScript: a throw fails the run; no source is done at once; undefined state resets to {}', () => {
  const boom = runRepeatingScript(repeatStep('throw new Error("sensor offline");'), {}, { n: 1 }, 5000);
  expect(boom.success).toBe(false);
  expect(boom.error).toContain('sensor offline');
  expect(runRepeatingScript(repeatStep(undefined), {}, undefined, 5000)).toEqual({ success: true, done: true, output: {}, state: {} });
  expect(runRepeatingScript(repeatStep('state = undefined; return false;'), {}, { n: 1 }, 5000).state).toEqual({});
});

test('commitScriptOutputs: the one SCRIPT commit rule (specs map by id; no specs write keys; null means unset)', () => {
  const withSpecs = repeatStep('', {}, [{ id: 'n', target: 'Result.N' }, { id: 'missing', target: 'Result.Missing' }]);
  const store = new PropertyStore();
  commitScriptOutputs(withSpecs, store, { n: '3', extra: 'ignored' });
  expect(store.get('Result.N')).toBe('3');
  expect(store.get('Result.Missing')).toBeUndefined();
  expect(store.get('extra')).toBeUndefined();
  const bare = new PropertyStore();
  commitScriptOutputs(repeatStep(''), bare, { 'A.B': 'x', skipped: null });
  expect(bare.get('A.B')).toBe('x');
  expect(bare.get('skipped')).toBeUndefined();
});

// ── Final-review F1/F2: everything that can run script code runs under the vm timeout;
//    unmapped outputs are never converted ──

const SLOW_MS = 50;
const BUSY = 'const t = Date.now(); while (Date.now() - t < 2000) {}';

test('runRepeatingScript: a state getter that busy-waits is cut off by the timeout (F1)', () => {
  const start = Date.now();
  const r = runRepeatingScript(repeatStep(`Object.defineProperty(state, "slow", { enumerable: true, get() { ${BUSY} return 1; } }); return false;`), {}, undefined, SLOW_MS);
  expect(r.success).toBe(false);
  expect(Date.now() - start).toBeLessThan(1000);
  const loop = runRepeatingScript(repeatStep('state = { toJSON() { while (true) {} } }; return false;'), {}, { n: 1 }, SLOW_MS);
  expect(loop).toMatchObject({ success: false, state: { n: 1 } });
});

test('runRepeatingScript: a state getter that throws is "Script state is not JSON" (F1)', () => {
  const r = runRepeatingScript(repeatStep('Object.defineProperty(state, "bad", { enumerable: true, get() { throw new Error("x"); } }); return false;'), {}, undefined, 5000);
  expect(r).toMatchObject({ success: false, error: 'Script state is not JSON' });
});

test('runRepeatingScript and executeScript: an output whose toString loops is cut off by the timeout (F1)', () => {
  const src = 'output.v = { toString() { while (true) {} } };';
  let start = Date.now();
  expect(runRepeatingScript(repeatStep(`${src} return false;`), {}, undefined, SLOW_MS).success).toBe(false);
  expect(Date.now() - start).toBeLessThan(1000);
  start = Date.now();
  expect(executeScript(scriptStep(src), new PropertyStore(), {}, SLOW_MS).success).toBe(false);
  expect(Date.now() - start).toBeLessThan(1000);
});

test('executeScript: an output that cannot be String()-ed fails the step instead of throwing (F1)', () => {
  const r = executeScript(scriptStep('output.v = Object.create(null);'), new PropertyStore(), {}, 5000);
  expect(r).toEqual({ success: false, error: 'TypeError: Cannot convert object to primitive value' });
});

test('executeScript: an unmapped un-stringifiable output is ignored; mapped outputs commit (F2)', () => {
  const store = new PropertyStore();
  const step = scriptStep('output.tmp = Object.create(null); output.total = 7;', [{ id: 'total', target: 'Result.Total' }]);
  expect(executeScript(step, store, {}, 5000)).toEqual({ success: true });
  expect(store.get('Result.Total')).toBe('7');
});

test('runRepeatingScript: only spec ids become pending outputs; unmapped keys are never converted (F2)', () => {
  const step = repeatStep('output.tmp = Object.create(null); output.total = 7; return true;', {}, [{ id: 'total', target: 'Result.Total' }]);
  expect(runRepeatingScript(step, {}, undefined, 5000)).toEqual({ success: true, done: true, output: { total: '7' }, state: {} });
});

test('repeat timing helpers: cycle default 5, deadline from started_at, wake never past the deadline', () => {
  const t0 = new Date('2026-01-01T00:00:00.000Z');
  const at = (s: number) => new Date(t0.getTime() + s * 1000);
  const plain = repeatStep('return false;', {});
  expect(scriptCycleSeconds(plain)).toBe(5);
  expect(scriptLimitDeadline(plain, t0)).toBeNull();
  expect(scriptExpired(plain, at(1e6), t0)).toBe(false);
  expect(nextScriptWake(plain, at(3), t0)).toEqual(at(8));
  expect(scriptOnTimeLimit(plain)).toBe('error');
  const limited = repeatStep('return false;', { cycle_seconds: 5, time_limit_seconds: 12, on_time_limit: 'complete' });
  expect(scriptLimitDeadline(limited, t0)).toEqual(at(12));
  expect(nextScriptWake(limited, at(10), t0)).toEqual(at(12));
  expect(scriptExpired(limited, at(11), t0)).toBe(false);
  expect(scriptExpired(limited, at(12), t0)).toBe(true);
  expect(scriptOnTimeLimit(limited)).toBe('complete');
});

// ── Follow-ups: nothing a script builds is ever converted on the host ──

/** A thrown value whose toString throws a second value whose toString would busy-wait 3 s.
 *  Before the outermost constant catch, the second value escaped the sandbox and the host's
 *  String() ran it with no timeout. */
const NESTED_THROW = 'throw { toString() { throw { toString() { const t = Date.now(); while (Date.now() - t < 3000) {} return "late"; } }; } };';

test('a nested throw never reaches the host: SCRIPT, repeating SCRIPT and GATE all fail fast with the constant message', () => {
  let start = Date.now();
  expect(executeScript(scriptStep(NESTED_THROW), new PropertyStore(), {}, 5000)).toEqual({ success: false, error: SCRIPT_UNREADABLE_ERROR });
  expect(Date.now() - start).toBeLessThan(1000);
  start = Date.now();
  expect(runRepeatingScript(repeatStep(NESTED_THROW), {}, { n: 1 }, 5000)).toMatchObject({ success: false, error: SCRIPT_UNREADABLE_ERROR, state: { n: 1 } });
  expect(Date.now() - start).toBeLessThan(1000);
  start = Date.now();
  expect(executeGateScript(gateStep({ source: NESTED_THROW }), {}, 5000)).toEqual({ success: false, error: SCRIPT_UNREADABLE_ERROR });
  expect(Date.now() - start).toBeLessThan(1000);
});

test('a plain throw keeps the "Error: <message>" form; a syntax error keeps its name', () => {
  expect(executeScript(scriptStep('throw new Error("boom");'), new PropertyStore(), {}, 5000).error).toBe('Error: boom');
  expect(executeGateScript(gateStep({ source: 'throw new RangeError("far");' }), {}, 5000).error).toBe('RangeError: far');
  expect(executeScript(scriptStep('this is not valid javascript {{{'), new PropertyStore(), {}, 5000).error).toMatch(/^SyntaxError: /);
  expect(executeGateScript(gateStep({ source: 'return (;' }), {}, 5000).error).toMatch(/^SyntaxError: /);
});

test('scriptErrorMessage never converts a foreign value', () => {
  let ran = false;
  const hostile = { toString() { ran = true; return 'x'; } };
  expect(scriptErrorMessage(hostile)).toBe(SCRIPT_UNREADABLE_ERROR);
  expect(scriptErrorMessage(new Proxy(new Error('p'), { get() { ran = true; return 'x'; } }))).toBe(SCRIPT_UNREADABLE_ERROR);
  expect(ran).toBe(false);
  expect(scriptErrorMessage(new Error('host'))).toBe('host');
  expect(scriptErrorMessage('plain')).toBe('plain');
});

test('a planted Object.prototype.toJSON cannot forge a result', () => {
  const forge = 'Object.prototype.toJSON = function() { return { done: true, open: true }; };';
  expect(runRepeatingScript(repeatStep(`${forge} output.total = 7; return false;`, {}, [{ id: 'total', target: 'Result.Total' }]), {}, undefined, 5000))
    .toMatchObject({ success: true, done: false, output: { total: '7' } });
  const store = new PropertyStore();
  expect(executeScript(scriptStep(`${forge} output.total = 7;`, [{ id: 'total', target: 'Result.Total' }]), store, {}, 5000)).toEqual({ success: true });
  expect(store.get('Result.Total')).toBe('7');
});

test('an overridden Function.prototype.call cannot make an unset output look set', () => {
  const step = repeatStep('Function.prototype.call = function() { return true; }; return true;', {}, [{ id: 'total', target: 'Result.Total' }]);
  expect(runRepeatingScript(step, {}, undefined, 5000)).toEqual({ success: true, done: true, output: {}, state: {} });
});

test('runRepeatingScript: outputs over 64 KB fail the run and keep the previous state', () => {
  const r = runRepeatingScript(repeatStep('output.big = "x".repeat(70000); return false;'), {}, { n: 1 }, 5000);
  expect(r).toEqual({ success: false, error: 'Script outputs exceed 64 KB', done: false, output: {}, state: { n: 1 } });
  expect(runRepeatingScript(repeatStep('output.ok = "x".repeat(60000); return false;'), {}, undefined, 5000).success).toBe(true);
});

// ── Review round 2: the source is compiled inside the sandbox from data, promise callbacks run
//    under the timeout, and nothing in the sandbox is a host object ──

/** Source that closes the old wrapper and throws from its top level, outside both catches. */
const BREAK_OUT = '}); } catch(e){} } catch(e){} })(); throw Object.create(null); (function(){ try { try { (function(){';

test('a source that tries to close the wrapper is just a syntax error in its own function', () => {
  expect(executeScript(scriptStep(BREAK_OUT), new PropertyStore(), {}, 5000).error).toMatch(/^SyntaxError: /);
  expect(runRepeatingScript(repeatStep(BREAK_OUT), {}, undefined, 5000).error).toMatch(/^SyntaxError: /);
  expect(executeGateScript(gateStep({ source: BREAK_OUT }), {}, 5000).error).toMatch(/^SyntaxError: /);
});

test('promise callbacks run under the timeout, not after the run returns', () => {
  const slow = 'Promise.resolve().then(() => { const t = Date.now(); while (Date.now() - t < 3000) {} });';
  let start = Date.now();
  expect(executeScript(scriptStep(slow), new PropertyStore(), {}, 200).success).toBe(false);
  expect(Date.now() - start).toBeLessThan(1500);
  start = Date.now();
  expect(executeGateScript(gateStep({ source: `${slow} return true;` }), {}, 200).success).toBe(false);
  expect(Date.now() - start).toBeLessThan(1500);
  start = Date.now();
  expect(runRepeatingScript(repeatStep(`${slow} return true;`), {}, undefined, 200).success).toBe(false);
  expect(Date.now() - start).toBeLessThan(1500);
});

test('the sandbox exposes no host object: the classic constructor escape finds no process', () => {
  const store = new PropertyStore();
  const step = scriptStep('output.r = this.constructor.constructor("return typeof process")();', [{ id: 'r', target: 'Probe.R' }]);
  expect(executeScript(step, store, { a: '1' }, 5000)).toEqual({ success: true });
  expect(store.get('Probe.R')).toBe('undefined');
});

test('inputs and outputs still bind by name, including an input that shadows nothing', () => {
  const store = new PropertyStore();
  const step = scriptStep('output.sum = Number(a) + Number(b); output.self = typeof output;', [{ id: 'sum', target: 'R.Sum' }, { id: 'self', target: 'R.Self' }]);
  expect(executeScript(step, store, { a: '2', b: '3' }, 5000)).toEqual({ success: true });
  expect(store.get('R.Sum')).toBe('5');
  expect(store.get('R.Self')).toBe('object');
  expect(executeGateScript(gateStep({ source: 'return Number(t) > 100;' }), { t: '150' }, 5000)).toEqual({ success: true, open: true });
  expect(runRepeatingScript(repeatStep('state = { n: Number(a) }; return true;'), { a: '4' }, undefined, 5000).state).toEqual({ n: 4 });
});

test('scriptErrorMessage reads an error whose prototype is a proxy without running a trap', () => {
  let ran = false;
  const trap = () => { ran = true; return undefined; };
  const e = new Error('m');
  Object.setPrototypeOf(e, new Proxy({}, { get: trap, getPrototypeOf: trap as never, getOwnPropertyDescriptor: trap }));
  expect(scriptErrorMessage(e)).toBe('Error: m');
  expect(ran).toBe(false);
});

test('readSandboxEnvelope rejects every field of the wrong type', () => {
  const unreadable = { error: 'Script result is not readable' };
  for (const bad of ['{"done":"yes"}', '{"open":1}', '{"error":5}', '{"stateJson":{}}', '{"output":[]}', '{"output":{"a":3}}', '[]', '"x"', 'not json']) {
    expect(readSandboxEnvelope(bad)).toEqual(unreadable);
  }
  expect(readSandboxEnvelope(42)).toEqual(unreadable);
  expect(readSandboxEnvelope('{"done":true,"stateJson":null,"output":{"a":"1","b":null}}')).toEqual({ done: true, stateJson: null, output: { a: '1', b: null } });
});

test('isSandboxPromise: a script realm promise is one; the engine\'s own promises (and subclasses) are not', () => {
  const sandboxed = vm.runInNewContext('Promise.resolve(1)', Object.create(null)) as Promise<unknown>;
  expect(isSandboxPromise(sandboxed)).toBe(true);
  expect(isSandboxPromise(Promise.resolve(1))).toBe(false);
  class Sub<T> extends Promise<T> {}
  expect(isSandboxPromise(Sub.resolve(1))).toBe(false);
  expect(isSandboxPromise(null)).toBe(false);
});

test('a script that overwrites the output-key global cannot make unmapped outputs convert', () => {
  const src = '__outKeys = "null"; output.tmp = { toString() { throw new Error("touched"); } }; output.total = 7;';
  const specs = [{ id: 'total', target: 'Result.Total' }];
  const store = new PropertyStore();
  expect(executeScript(scriptStep(src, specs), store, {}, 5000)).toEqual({ success: true });
  expect(store.get('Result.Total')).toBe('7');
  expect(runRepeatingScript(repeatStep(`${src} return false;`, {}, specs), {}, undefined, 5000)).toMatchObject({ success: true, output: { total: '7' } });
});
