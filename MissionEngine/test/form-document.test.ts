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
// schemaVersion 5.0 (form_document envelope): validation acceptance, the
// getFormElements form_document fallback, capture-through-submit, and the
// UNBOUND_FORM_INPUT guard's form_document walk.
// Spec: docs/superpowers/specs/2026-08-03-schemaversion-5-design.md
import { expect, test } from 'vitest';
import { validate } from '../src/spec/validator.js';
import { getFormElements } from '../src/core/step-handlers.js';
import { makeTestDb } from './helpers/db.js';
import { pumpUntilQuiet, testDeps } from './helpers/pump.js';
import { workCenter, workflow, workflowInstance, stepInstance, traceEntry } from 'mission-control-db/src/db/schema/index';
import { eq } from 'drizzle-orm';
import { submitUserAction } from '../src/core/submit.js';

const step = (oid: string, step_type: string, extra: Record<string, unknown> = {}) => ({
  local_id: oid, oid, step_type, version: '1.0.0', last_modified_date: '2026-01-01', ...extra,
});

// Minimal machine-executable 5.0 spec — same ManagedElement completeness the engine's
// ajv structural validation demands (mirrors exec-linear-001 / machineWorkflowPackage).
const SPEC_50 = {
  local_id: 'wf50', oid: 'wf50', version: '1.0.0', last_modified_date: '2026-01-01',
  schemaVersion: '5.0',
  steps: [step('s1', 'START'), step('e1', 'END')],
  connections: [{ from_step_id: 's1', to_step_id: 'e1' }],
};

test('a schemaVersion 5.0 spec passes validation', () => {
  const res = validate(SPEC_50 as never);
  expect(res.valid).toBe(true);
});

const FORM_DOC = {
  version: 2,
  sections: [{
    id: 'sec1', role: 'content',
    rows: [
      { id: 'r1', blocks: [
        { id: 'b1', type: 'textInput', fieldName: 'name', label: 'Name', outputParameter: 'Response.Name' },
        { id: 'b2', type: 'timer', fieldName: 'elapsed', label: 'Elapsed', durationSeconds: 60, direction: 'countup', outputParameter: 'Response.Elapsed' },
      ] },
      { id: 'r2', blocks: [
        { id: 'b3', type: 'button', label: 'Submit', outputValue: 'done' },
        { id: 'b4', type: 'header', text: 'Title' },
      ] },
    ],
  }],
};

test('getFormElements maps form_document blocks with a fieldName; buttons and static blocks excluded', () => {
  const s = step('ui', 'USER_INTERACTION', { form_document: FORM_DOC });
  const els = getFormElements(s as never);
  expect(els.map((e) => ('fieldName' in e ? e.fieldName : null))).toEqual(['name', 'elapsed']);
  expect(els[0]).toMatchObject({ type: 'textInput', fieldName: 'name', label: 'Name', outputParameter: 'Response.Name' });
  expect(els[1]).toMatchObject({ type: 'timer', fieldName: 'elapsed', outputParameter: 'Response.Elapsed' });
});

test('getFormElements degrades to [] on a malformed form_document instead of throwing (non-array sections/rows/blocks)', () => {
  expect(getFormElements(step('ui', 'USER_INTERACTION', { form_document: { version: 2, sections: {} } }) as never)).toEqual([]);
  expect(getFormElements(step('ui', 'USER_INTERACTION', { form_document: { version: 2, sections: [{ rows: {} }] } }) as never)).toEqual([]);
  expect(getFormElements(step('ui', 'USER_INTERACTION', { form_document: { version: 2, sections: [{ rows: [{ blocks: {} }] }] } }) as never)).toEqual([]);
});

test('form_layout_config keeps priority over form_document when both exist', () => {
  const s = step('ui', 'USER_INTERACTION', {
    form_layout_config: [{ deviceType: 'phone', canvasWidth: 390, canvasHeight: 844, elements: [
      { type: 'textInput', x: 0, y: 0, width: 300, height: 40, fieldName: 'legacy', outputParameter: 'Legacy.Out' },
    ] }],
    form_document: FORM_DOC,
  });
  const els = getFormElements(s as never);
  expect(els.map((e) => ('fieldName' in e ? e.fieldName : null))).toEqual(['legacy']);
});

// Post-merge ticket pin (Task 12): schemaVersion-5 spec §2.3 adapter order — a full
// phone/tablet/desktop triplet still wins over form_document, and getFormElements uses the
// FIRST entry (phone) regardless of how many breakpoints are present.
const TRIPLET_LAYOUT = [
  { deviceType: 'phone', canvasWidth: 390, canvasHeight: 844, elements: [
    { type: 'textInput', x: 0, y: 0, width: 300, height: 40, fieldName: 'legacyPhone', outputParameter: 'Legacy.Phone' },
  ] },
  { deviceType: 'tablet', canvasWidth: 768, canvasHeight: 1024, elements: [
    { type: 'textInput', x: 0, y: 0, width: 400, height: 40, fieldName: 'legacyTablet', outputParameter: 'Legacy.Tablet' },
  ] },
  { deviceType: 'desktop', canvasWidth: 1280, canvasHeight: 800, elements: [
    { type: 'textInput', x: 0, y: 0, width: 500, height: 40, fieldName: 'legacyDesktop', outputParameter: 'Legacy.Desktop' },
  ] },
];

test('form_layout_config precedence: a full phone/tablet/desktop triplet plus a form_document — the triplet (first/phone entry) wins', () => {
  const s = step('ui', 'USER_INTERACTION', {
    form_layout_config: TRIPLET_LAYOUT,
    form_document: FORM_DOC,
  });
  const els = getFormElements(s as never);
  expect(els.map((e) => ('fieldName' in e ? e.fieldName : null))).toEqual(['legacyPhone']);
  expect(els[0]).toMatchObject({ type: 'textInput', fieldName: 'legacyPhone', outputParameter: 'Legacy.Phone' });
});

test('form_layout_config precedence: a plain-object shape (not array) plus a form_document — the object still wins', () => {
  const s = step('ui', 'USER_INTERACTION', {
    form_layout_config: { elements: [
      { type: 'textInput', x: 0, y: 0, width: 300, height: 40, fieldName: 'legacyObj', outputParameter: 'Legacy.Obj' },
    ] },
    form_document: FORM_DOC,
  });
  const els = getFormElements(s as never);
  expect(els.map((e) => ('fieldName' in e ? e.fieldName : null))).toEqual(['legacyObj']);
});

// Post-merge ticket (Task 9): form_document block type hardening — ensure non-string
// or empty-string types default to 'textInput', not pass through garbage values.
test('form_document block with numeric type 5 falls back to textInput', () => {
  const s = step('ui', 'USER_INTERACTION', {
    form_document: {
      version: 2,
      sections: [{
        id: 'sec1', role: 'content',
        rows: [{ id: 'r1', blocks: [
          { id: 'b1', type: 5, fieldName: 'numType', label: 'NumType' },
        ] }],
      }],
    },
  });
  const els = getFormElements(s as never);
  expect(els).toHaveLength(1);
  expect(els[0].type).toBe('textInput');
});

test('form_document block with absent type defaults to textInput', () => {
  const s = step('ui', 'USER_INTERACTION', {
    form_document: {
      version: 2,
      sections: [{
        id: 'sec1', role: 'content',
        rows: [{ id: 'r1', blocks: [
          { id: 'b1', fieldName: 'absType', label: 'AbsType' },
        ] }],
      }],
    },
  });
  const els = getFormElements(s as never);
  expect(els).toHaveLength(1);
  expect(els[0].type).toBe('textInput');
});

test('form_document block with valid non-empty string type preserved verbatim', () => {
  const s = step('ui', 'USER_INTERACTION', {
    form_document: {
      version: 2,
      sections: [{
        id: 'sec1', role: 'content',
        rows: [{ id: 'r1', blocks: [
          { id: 'b1', type: 'checkbox', fieldName: 'checkType', label: 'CheckType' },
        ] }],
      }],
    },
  });
  const els = getFormElements(s as never);
  expect(els).toHaveLength(1);
  expect(els[0].type).toBe('checkbox');
});

test('form_document block with empty string type falls back to textInput', () => {
  const s = step('ui', 'USER_INTERACTION', {
    form_document: {
      version: 2,
      sections: [{
        id: 'sec1', role: 'content',
        rows: [{ id: 'r1', blocks: [
          { id: 'b1', type: '', fieldName: 'emptyType', label: 'EmptyType' },
        ] }],
      }],
    },
  });
  const els = getFormElements(s as never);
  expect(els).toHaveLength(1);
  expect(els[0].type).toBe('textInput');
});

// Integration: a full 5.0 UI workflow — submit captures form values into the property store.
const UI_SPEC_50 = {
  local_id: 'wf50ui', oid: 'wf50ui', version: '1.0.0', last_modified_date: '2026-01-01',
  schemaVersion: '5.0',
  steps: [
    step('s1', 'START'),
    step('ui', 'USER_INTERACTION', {
      form_document: FORM_DOC,
      output_parameter_specifications: [
        { id: 'Response.Name', target: 'Response.Name' },
        { id: 'Response.Elapsed', target: 'Response.Elapsed' },
      ],
    }),
    step('e1', 'END'),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 'ui' },
    { from_step_id: 'ui', to_step_id: 'e1' },
  ],
};

// 2026-08-10 downgrade (user-testing ticket): an unbound interactive element is authoring
// sloppiness, not a poisoned spec — the run proceeds and captureFormOutputs discards the
// value, so the guard now yields a non-fatal warning instead of erroring the instance.
test('unbound form_document inputs pass validation with one UNBOUND_FORM_INPUT warning each', () => {
  const sloppy = {
    ...SPEC_50, oid: 'wf50warn', local_id: 'wf50warn',
    steps: [
      step('s1', 'START'),
      step('ui', 'USER_INTERACTION', {
        form_document: { version: 2, sections: [{ id: 'sec1', role: 'content', rows: [
          { id: 'r1', blocks: [
            { id: 'b1', type: 'textInput', fieldName: 'name', label: 'Any Text' },
            { id: 'b2', type: 'checkbox', fieldName: 'agree', label: 'Agree', options: ['yes'] },
          ] },
        ] }] },
      }),
      step('e1', 'END'),
    ],
    connections: [
      { from_step_id: 's1', to_step_id: 'ui' },
      { from_step_id: 'ui', to_step_id: 'e1' },
    ],
  };
  const res = validate(sloppy as never);
  expect(res.valid).toBe(true);
  expect(res.error_code).toBeUndefined();
  expect(res.warnings).toHaveLength(2);
  expect(res.warnings![0].code).toBe('UNBOUND_FORM_INPUT');
  expect(res.warnings![0].message).toContain('form_document layout');
  expect(res.warnings![0].message).toContain('Any Text');
  expect(res.warnings![1].message).toContain('Agree');
});

test('validator: two esignature blocks → ESIGNATURE_MULTIPLE_BLOCKS advisory, still valid; one block without outputParameter → UNBOUND_FORM_INPUT', () => {
  const twoBlocks = { ...UI_SPEC_50, oid: 'wf-two-esig', steps: UI_SPEC_50.steps.map((s) => s.oid !== 'ui' ? s : { ...s, form_document: {
    version: 2, sections: [{ id: 'sec1', role: 'content', rows: [{ id: 'r1', blocks: [
      { id: 'e1', type: 'esignature', fieldName: 'a', outputParameter: 'Response.Name' },
      { id: 'e2', type: 'esignature', fieldName: 'b' },
    ] }] }],
  } }) };
  const res = validate(twoBlocks as never);
  expect(res.valid).toBe(true);
  expect(res.warnings!.map((w) => w.code).sort()).toEqual(['ESIGNATURE_MULTIPLE_BLOCKS', 'UNBOUND_FORM_INPUT']);
  expect(res.warnings!.find((w) => w.code === 'ESIGNATURE_MULTIPLE_BLOCKS')!.message).toContain('first in document order');
});

test('a fully bound spec reports no warnings field at all', () => {
  const res = validate(UI_SPEC_50 as never);
  expect(res.valid).toBe(true);
  expect(res.warnings).toBeUndefined();
});

test('a bound form_document form passes the guard (and a timer never needs a binding)', () => {
  const good = {
    ...SPEC_50, oid: 'wf50good', local_id: 'wf50good',
    steps: [
      step('s1', 'START'),
      step('ui', 'USER_INTERACTION', {
        form_document: { version: 2, sections: [{ id: 'sec1', role: 'content', rows: [
          { id: 'r1', blocks: [
            { id: 'b1', type: 'textInput', fieldName: 'name', outputParameter: 'Response.Name' },
            { id: 'b2', type: 'timer', fieldName: 'elapsed', durationSeconds: 5, direction: 'countdown' },
          ] },
        ] }] },
        output_parameter_specifications: [{ id: 'Response.Name', target: 'Response.Name' }],
      }),
      step('e1', 'END'),
    ],
    connections: [
      { from_step_id: 's1', to_step_id: 'ui' },
      { from_step_id: 'ui', to_step_id: 'e1' },
    ],
  };
  const res = validate(good as never);
  expect(res.valid).toBe(true);
});

async function seedQueued(db: any, spec: unknown, oid: string): Promise<{ id: string }> {
  const [wc] = await db.insert(workCenter).values({ name: `wc-${Math.random()}`, path: `p${Math.random()}` }).returning();
  const [wf] = await db.insert(workflow).values({ workCenterId: wc.id, oid, name: oid, version: '1.0.0', state: 'Approved', specJsonb: spec }).returning();
  const [wi] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'queued', queuedAt: new Date(),
    specJsonb: spec, startingParams: null, runtimeNumber: 1, runtimeLabel: 'RW-1',
    masterName: oid, masterOid: oid, masterVersion: '1.0.0', masterState: 'Approved',
  }).returning();
  return wi;
}

test('a 5.0 USER_INTERACTION submit captures form_values through form_document bindings', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, UI_SPEC_50, 'wf50ui');
  await pumpUntilQuiet(db, testDeps());

  await submitUserAction(db, wi.id, {
    step_oid: 'ui', action: 'button_press', button_output: 'done',
    form_values: { name: 'Alice', elapsed: '42' },
  }, 1, testDeps());

  const [after] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, wi.id));
  expect(after.status).toBe('completed');
  expect(after.propertyStore).toMatchObject({ 'Response.Name': 'Alice', 'Response.Elapsed': '42' });
  await close();
});

// Runtime half of the 2026-08-10 downgrade: the instance STARTS (no terminal 'errored'),
// carries a WARNING trace row instead, and the submitted value for the unbound field is
// discarded by captureFormOutputs exactly as the warning text promises.
const UNBOUND_RUNTIME_SPEC = {
  ...SPEC_50, oid: 'wf50unbound', local_id: 'wf50unbound',
  steps: [
    step('s1', 'START'),
    step('ui', 'USER_INTERACTION', {
      form_document: { version: 2, sections: [{ id: 'sec1', role: 'content', rows: [
        { id: 'r1', blocks: [
          { id: 'b1', type: 'textInput', fieldName: 'name', label: 'Any Text' },
          { id: 'b2', type: 'button', label: 'Submit', outputValue: 'done' },
        ] },
      ] }] },
    }),
    step('e1', 'END'),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 'ui' },
    { from_step_id: 'ui', to_step_id: 'e1' },
  ],
};

test('an unbound textInput no longer errors the run: WARNING trace at start, submit discards the value, instance completes', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, UNBOUND_RUNTIME_SPEC, 'wf50unbound');
  await pumpUntilQuiet(db, testDeps());

  const [running] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, wi.id));
  expect(running.status).toBe('running');

  const traces = await db.select().from(traceEntry).where(eq(traceEntry.workflowInstanceId, wi.id));
  expect(traces.some((t: any) => t.state === 'ERRORED')).toBe(false);
  const warning = traces.find((t: any) => t.state === 'WARNING');
  expect(warning?.error).toContain('has no outputParameter binding');
  expect(warning?.error).toContain('Any Text');
  expect(warning?.stepOid).toBeNull();

  await submitUserAction(db, wi.id, {
    step_oid: 'ui', action: 'button_press', button_output: 'done',
    form_values: { name: 'Bob' },
  }, 1, testDeps());

  const [after] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, wi.id));
  expect(after.status).toBe('completed');
  expect(JSON.stringify(after.propertyStore ?? {})).not.toContain('Bob');
  await close();
});

// Post-merge ticket pin (Task 12): YES_NO x form_document composition. A YES_NO step can carry
// a form_document layout (same as USER_INTERACTION) — getFormElements flattens it identically,
// and handleUserAction's YES_NO branch captures form_values through it while routing off
// button_output. Per Task 10's note, the operator API's realistic action shape sets BOTH
// action and button_output to the decision literal ('yes'/'no' — see api/app.ts's
// kind:'decision' handler), not 'button_press'.
const YESNO_FORM_DOC = {
  version: 2,
  sections: [{
    id: 'sec1', role: 'content',
    rows: [{ id: 'r1', blocks: [
      { id: 'b1', type: 'textInput', fieldName: 'reason', label: 'Reason', outputParameter: 'Response.Reason' },
    ] }],
  }],
};

const YESNO_FORMDOC_SPEC = {
  local_id: 'wfynfd', oid: 'wfynfd', version: '1.0.0', last_modified_date: '2026-01-01',
  schemaVersion: '5.0',
  steps: [
    step('s1', 'START'),
    step('yn', 'YES_NO', {
      form_document: YESNO_FORM_DOC,
      output_parameter_specifications: [{ id: 'Response.Reason', target: 'Response.Reason' }],
    }),
    step('end-yes', 'END'),
    step('end-no', 'END'),
  ],
  connections: [
    { from_step_id: 's1', to_step_id: 'yn' },
    { from_step_id: 'yn', to_step_id: 'end-yes', source_handle_id: 'yes' },
    { from_step_id: 'yn', to_step_id: 'end-no', source_handle_id: 'no' },
  ],
};

test('getFormElements flattens a form_document on a YES_NO step the same as USER_INTERACTION', () => {
  const s = step('yn', 'YES_NO', { form_document: YESNO_FORM_DOC });
  const els = getFormElements(s as never);
  expect(els.map((e) => ('fieldName' in e ? e.fieldName : null))).toEqual(['reason']);
  expect(els[0]).toMatchObject({ type: 'textInput', fieldName: 'reason', label: 'Reason', outputParameter: 'Response.Reason' });
});

test('a YES_NO step with a bound form_document: submitUserAction captures the bound output AND routes the yes-branch', async () => {
  const { db, close } = await makeTestDb();
  const wi = await seedQueued(db, YESNO_FORMDOC_SPEC, 'wfynfd');
  await pumpUntilQuiet(db, testDeps());

  await submitUserAction(db, wi.id, {
    step_oid: 'yn', action: 'yes', button_output: 'yes',
    form_values: { reason: 'looks good' },
  }, 0, testDeps());

  const [after] = await db.select().from(workflowInstance).where(eq(workflowInstance.id, wi.id));
  expect(after.status).toBe('completed');
  expect(after.propertyStore).toMatchObject({ 'Response.Reason': 'looks good' });

  const steps = await db.select().from(stepInstance).where(eq(stepInstance.workflowInstanceId, wi.id));
  expect(steps.find((r: any) => r.stepOid === 'end-yes')?.state).toBe('COMPLETED');
  expect(steps.find((r: any) => r.stepOid === 'end-no')).toBeUndefined();
  await close();
});
