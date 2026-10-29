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
// Builds the sample .WFmasterX / .WFenvirX packages the import legs upload through the
// browser file-chooser. Self-contained (adm-zip, a direct devDependency) rather than
// importing mission-control-db's buildWfmasterx: node_modules/mission-control-db is a
// workspace SYMLINK, so Playwright's ESM loader cannot resolve its extensionless TS path
// (a `--list` probe errors "Cannot find module …/sample-bundle"), and a `.ts`-extension
// import would fail tsc. The four-line zip assembly is mirrored here instead. The sample
// specs are minimal; their real validation is the live server ingesting them in the
// import legs — a schema-incompat fails the run, not a mock.
import AdmZip from 'adm-zip';

export type FilePayload = { name: string; mimeType: string; buffer: Buffer };

const MIME = 'application/zip';

// A .WFmasterX is a zip whose root "<local_id>.WFmaster" entry is the workflow JSON
// (mirrors mission-control-db/src/seed/sample-bundle.ts::buildWfmasterx). Two nodes
// (root + one child) and two UI steps (the START step is non-UI and ingest filters it).
export function sampleWorkflowPackage(): FilePayload {
  const root = {
    local_id: 'E2E Sample Workflow', oid: 'e2e-wf-1', version: '1.0.0', state: 'Effective', schemaVersion: '4.0',
    steps: [
      { local_id: 'Begin', oid: 'e2e-s0', step_type: 'START' },
      { local_id: 'Do the thing', oid: 'e2e-s1', step_type: 'USER_INTERACTION' },
    ],
    connections: [],
    children: [
      {
        local_id: 'Sub Task', oid: 'e2e-wf-1-c1', parentChildSpecId: null, version: '1.0.0', state: 'Effective',
        steps: [{ local_id: 'Confirm', oid: 'e2e-s2', step_type: 'YES_NO' }], connections: [],
      },
    ],
  };
  const zip = new AdmZip();
  zip.addFile(`${root.local_id}.WFmaster`, Buffer.from(JSON.stringify(root), 'utf8'));
  return { name: 'e2e-sample.WFmasterX', mimeType: MIME, buffer: zip.toBuffer() };
}

// A single-env .WFenvirX is a zip whose "<local_id>.WFenvir" entry is the env-spec JSON.
// The single-env shape (has included_actions, no environment_specifications[]) is what
// ingest disambiguates on; library_name groups it into its own "E2E Imports" library.
export function sampleEnvironmentPackage(): FilePayload {
  const env = {
    local_id: 'E2E Sample Env', oid: 'e2e-env-1', version: '1.0.0', state: 'Effective', schemaVersion: '4.0',
    library_name: 'E2E Imports', included_actions: [],
  };
  const zip = new AdmZip();
  zip.addFile(`${env.local_id}.WFenvir`, Buffer.from(JSON.stringify(env), 'utf8'));
  return { name: 'e2e-sample.WFenvirX', mimeType: MIME, buffer: zip.toBuffer() };
}

// Parameterized builders for the pull legs — distinct oids from the sample* fixtures so the
// pull legs stay independent of the import legs.
//
// oid is per-VERSION unique in Studio: cloneSpecificationSubtree mints a fresh uuid for
// every row, including the root, on New Version. So a caller modelling a version bump MUST
// pass a new oid. Reusing one oid across two versions models a package Studio cannot
// produce — the M4 fixture did exactly that and hid a status bug.
export function workflowPackage(opts: {
  localId: string; oid: string; version?: string; state?: string; libraryOid?: string;
  // ISA 88 type of the root workflow, written as root `type_name` only when given.
  typeName?: string;
  // Optional and omitted by every pre-existing caller, so their zip bytes are unchanged —
  // opt in to exercise the parameter-entry dialog (runtime-workflows.spec.ts's leg 1).
  startingParameterSpecifications?: Array<{
    id: string; default_value: string; value_type?: 'literal' | 'property'; description?: string;
  }>;
}): FilePayload {
  const version = opts.version ?? '1.0.0';
  const root = {
    local_id: opts.localId, oid: opts.oid, version,
    state: opts.state ?? 'Effective', schemaVersion: '5.0',
    ...(opts.libraryOid ? { library_name: 'E2E Studio Library', library_oid: opts.libraryOid } : {}),
    ...(opts.typeName ? { type_name: opts.typeName } : {}),
    ...(opts.startingParameterSpecifications
      ? { starting_parameter_specifications: opts.startingParameterSpecifications }
      : {}),
    steps: [{ local_id: 'Begin', oid: `${opts.oid}-s0`, step_type: 'START' }], connections: [], children: [],
  };
  const zip = new AdmZip();
  zip.addFile(`${root.local_id}.WFmaster`, Buffer.from(JSON.stringify(root), 'utf8'));
  return { name: `${opts.oid}-v${version}.WFmasterX`, mimeType: MIME, buffer: zip.toBuffer() };
}

// A workflow package built specifically for the Diagram tab: explicit positions, an
// explicit display_style, and a WORKFLOW PROXY step whose local_id matches the child's so
// the server's name-based proxy linkage resolves (see dao/workflow-diagram.ts).
//
// Deliberately NOT a change to sampleWorkflowPackage(): that builder is consumed by
// package-round-trip.spec.ts and package-save.spec.ts, and adding a step to it would move
// counts those specs assert on.
export function diagramWorkflowPackage(): FilePayload {
  const root = {
    local_id: 'E2E Diagram Workflow', oid: 'e2e-dg-1', version: '1.0.0', state: 'Effective',
    schemaVersion: '4.0', display_style: 'bpmn',
    steps: [
      { local_id: 'Begin', oid: 'e2e-dg-s0', step_type: 'START', position: { x: 0, y: 100 } },
      { local_id: 'Approve', oid: 'e2e-dg-s1', step_type: 'USER_INTERACTION', position: { x: 200, y: 90 } },
      { local_id: 'Sub Assembly', oid: 'e2e-dg-s2', step_type: 'WORKFLOW PROXY', position: { x: 450, y: 90 } },
      { local_id: 'Finish', oid: 'e2e-dg-s3', step_type: 'END', position: { x: 700, y: 100 } },
    ],
    connections: [
      { from_step_id: 'e2e-dg-s0', to_step_id: 'e2e-dg-s1' },
      { from_step_id: 'e2e-dg-s1', to_step_id: 'e2e-dg-s2' },
      { from_step_id: 'e2e-dg-s2', to_step_id: 'e2e-dg-s3' },
    ],
    children: [
      {
        local_id: 'Sub Assembly', oid: 'e2e-dg-c1', parentChildSpecId: null,
        version: '1.0.0', state: 'Effective',
        steps: [
          { local_id: 'Inner Check', oid: 'e2e-dg-cs0', step_type: 'YES_NO', position: { x: 10, y: 10 } },
        ],
        connections: [],
      },
    ],
  };
  const zip = new AdmZip();
  zip.addFile(`${root.local_id}.WFmaster`, Buffer.from(JSON.stringify(root), 'utf8'));
  return { name: 'e2e-diagram.WFmasterX', mimeType: MIME, buffer: zip.toBuffer() };
}

// A workflow package that is MACHINE-EXECUTABLE by a live Mission Engine: a real,
// connected START -> END graph (no UI steps, no action steps), with every ManagedElement
// in it — the ROOT workflow object itself included, not just its steps — carrying the
// full local_id/oid/version/last_modified_date set the engine's own ajv structural
// validation requires (spec/workflow-schema.json's root `allOf` composes in the SAME
// ManagedElement $ref its steps use, verified against the engine's real conformance
// fixtures, e.g. src/conformance/fixtures/execution/exec-linear-001-start-end.json).
// workflowPackage() above omits all of this (its single bare START step, with no
// last_modified_date anywhere, is fine for every OTHER e2e spec — none of which ever
// start a LIVE engine against the package) — this is a distinct builder, not a
// modification of that one, so every existing workflowPackage() caller's zip bytes stay
// unchanged. Optional startingParameterSpecifications mirrors workflowPackage()'s own
// opt-in shape (runtime-workflows.spec.ts exercises it).
export function machineWorkflowPackage(opts: {
  localId: string; oid: string; version?: string; state?: string;
  startingParameterSpecifications?: Array<{
    id: string; default_value: string; value_type?: 'literal' | 'property'; description?: string;
  }>;
}): FilePayload {
  const version = opts.version ?? '1.0.0';
  const lastModified = '2026-01-01T00:00:00Z';
  const startOid = `${opts.oid}-s0`;
  const endOid = `${opts.oid}-s1`;
  const root = {
    local_id: opts.localId, oid: opts.oid, version, last_modified_date: lastModified,
    // '5.0' — the real Studio export envelope. The engine's ajv validation accepts it as of
    // the 2026-08-03 schemaVersion-5.0 fix (docs/superpowers/specs/2026-08-03-schemaversion-5-design.md);
    // this fixture doubles as the live-engine proof that the real format executes.
    state: opts.state ?? 'Effective', schemaVersion: '5.0',
    ...(opts.startingParameterSpecifications
      ? { starting_parameter_specifications: opts.startingParameterSpecifications }
      : {}),
    steps: [
      { local_id: 'Begin', oid: startOid, version: '1.0.0', last_modified_date: lastModified, step_type: 'START' },
      { local_id: 'Finish', oid: endOid, version: '1.0.0', last_modified_date: lastModified, step_type: 'END' },
    ],
    connections: [{ from_step_id: startOid, to_step_id: endOid }],
    children: [],
  };
  const zip = new AdmZip();
  zip.addFile(`${root.local_id}.WFmaster`, Buffer.from(JSON.stringify(root), 'utf8'));
  return { name: `${opts.oid}-v${version}-machine.WFmasterX`, mimeType: MIME, buffer: zip.toBuffer() };
}

// A workflow package built for the Cockpit leg (Task 11, phase 4b): a real, live-engine-
// executable 5.0 workflow with an actual UI surface — START -> USER_INTERACTION (a v2
// form_document with one required, bound textInput) -> YES_NO (Approve/Reject) -> two
// ENDs. Mirrors machineWorkflowPackage() exactly in envelope/zip mechanics (every
// ManagedElement carries local_id/oid/version/last_modified_date, schemaVersion '5.0').
//
// step_type strings: MissionEngine/src/core/step-handlers.ts's
// canonicalStepType() only remaps 'SELECT_1' -> 'SELECT 1' — 'USER_INTERACTION' and
// 'YES_NO' pass through verbatim, and both are in its needsUserAction() list, so they
// park for operator action exactly as written here.
//
// form_document shape: the engine's ajv structural validation treats form_document as an
// opaque object (spec/types.ts's MasterWorkflowStep types it as `Record<string, unknown>`,
// "treated structurally") — only the UNBOUND_FORM_INPUT guard (spec/validator.ts) walks it,
// and it requires nothing but a string, non-empty `outputParameter` on binding-required
// block types (textInput is one — INPUT_BINDING_REQUIRED_TYPES). That's satisfied below via
// `outputParameter: 'op-reason'` matching the step's own output_parameter_specifications id.
// `version: 2` and the `id` fields on the section/row/block are for the RENDER path instead:
// @mission/form-schema's FormDocument/Section/Row/BlockBase types (MissionFormKit/
// packages/form-schema/src/types.ts) declare all four as required, and the real renderer
// (FormDocumentView.tsx) keys its section/row/block DOM nodes off them — matches the shape
// MissionEngine/test/form-document.test.ts's own fixtures already use (FORM_DOC).
export function uiWorkflowPackage(opts: { localId: string; oid: string; version?: string }): FilePayload {
  const version = opts.version ?? '1.0.0';
  const lastModified = '2026-01-01T00:00:00Z';
  const s = (suffix: string) => `${opts.oid}-${suffix}`;
  const root = {
    local_id: opts.localId, oid: opts.oid, version, last_modified_date: lastModified,
    state: 'Effective', schemaVersion: '5.0',
    steps: [
      { local_id: 'Begin', oid: s('start'), version: '1.0.0', last_modified_date: lastModified, step_type: 'START' },
      {
        local_id: 'Fill Details', oid: s('form'), version: '1.0.0', last_modified_date: lastModified,
        step_type: 'USER_INTERACTION',
        output_parameter_specifications: [{ id: 'op-reason', default_value: '', target: 'Result.Reason' }],
        form_document: {
          version: 2,
          sections: [{
            id: 'sec1', role: 'content',
            rows: [{
              id: 'r1',
              blocks: [
                { id: 'b1', type: 'textInput', fieldName: 'reason', label: 'Reason', required: true, outputParameter: 'op-reason' },
              ],
            }],
          }],
        },
      },
      {
        local_id: 'Approve?', oid: s('gate'), version: '1.0.0', last_modified_date: lastModified,
        step_type: 'YES_NO',
        yes_no_config: { yes_label: 'Approve', no_label: 'Reject' },
      },
      { local_id: 'Approved', oid: s('end-yes'), version: '1.0.0', last_modified_date: lastModified, step_type: 'END' },
      { local_id: 'Rejected', oid: s('end-no'), version: '1.0.0', last_modified_date: lastModified, step_type: 'END' },
    ],
    connections: [
      { from_step_id: s('start'), to_step_id: s('form') },
      { from_step_id: s('form'), to_step_id: s('gate') },
      { from_step_id: s('gate'), to_step_id: s('end-yes'), source_handle_id: 'yes' },
      { from_step_id: s('gate'), to_step_id: s('end-no'), source_handle_id: 'no' },
    ],
    children: [],
  };
  const zip = new AdmZip();
  zip.addFile(`${root.local_id}.WFmaster`, Buffer.from(JSON.stringify(root), 'utf8'));
  return { name: `${opts.oid}-v${version}-ui.WFmasterX`, mimeType: MIME, buffer: zip.toBuffer() };
}

// E-signature (spec 2026-09-06, e2e Task 8): a live-engine-executable workflow whose UI
// surface carries the e-signature block on BOTH a USER_INTERACTION and a YES_NO step —
// NOT a modification of uiWorkflowPackage (existing callers' zip bytes must stay
// unchanged), copied verbatim (same envelope, `lastModified`, `s()` oid helper, START/END
// steps, connections, zip creation) with the two UI steps' form_document/local_id content
// replaced. USER_INTERACTION step ('Sign here'): a required `reason` textInput plus an
// `esignature` block ('approval', role 'Time Sheet Approver') — both output-bound, mirroring
// how uiWorkflowPackage binds op-reason. YES_NO step ('Approve?'): a single `esignature`
// block ('decision_signature', same role) whose `requireDifferentUser` is the caller's
// option — the engine requires a signature for every action on these steps except a `no`
// decision (spec D5), and this fixture's role restriction is granted separately by the spec
// via the sub-project 1 `PUT /api/work-centers/:id/users/:userId/roles` route (createRole +
// grantRole in cockpit-esignature.spec.ts), not by this builder.
export function esignatureWorkflowPackage(opts: { localId: string; oid: string; requireDifferentUser?: boolean }): FilePayload {
  const version = '1.0.0';
  const lastModified = '2026-01-01T00:00:00Z';
  const s = (suffix: string) => `${opts.oid}-${suffix}`;
  const root = {
    local_id: opts.localId, oid: opts.oid, version, last_modified_date: lastModified,
    state: 'Effective', schemaVersion: '5.0',
    steps: [
      { local_id: 'Begin', oid: s('start'), version: '1.0.0', last_modified_date: lastModified, step_type: 'START' },
      {
        local_id: 'Sign here', oid: s('form'), version: '1.0.0', last_modified_date: lastModified,
        step_type: 'USER_INTERACTION',
        output_parameter_specifications: [
          { id: 'op-reason', default_value: '', target: 'Result.Reason' },
          { id: 'op-approver', default_value: '', target: 'Result.Approver' },
        ],
        form_document: {
          version: 2,
          sections: [{
            id: 'sec1', role: 'content',
            rows: [{
              id: 'r1',
              blocks: [
                { id: 'b1', type: 'textInput', fieldName: 'reason', label: 'Reason', required: true, outputParameter: 'op-reason' },
                { id: 'b2', type: 'esignature', fieldName: 'approval', label: 'Approve', meaning: 'I approve this reason', roleName: 'Time Sheet Approver', outputParameter: 'op-approver' },
              ],
            }],
          }],
        },
      },
      {
        local_id: 'Approve?', oid: s('gate'), version: '1.0.0', last_modified_date: lastModified,
        step_type: 'YES_NO',
        yes_no_config: { yes_label: 'Approve', no_label: 'Reject' },
        form_document: {
          version: 2,
          sections: [{
            id: 'sec1', role: 'content',
            rows: [{
              id: 'r1',
              blocks: [
                { id: 'b3', type: 'esignature', fieldName: 'decision_signature', label: 'Decide', roleName: 'Time Sheet Approver', requireDifferentUser: opts.requireDifferentUser ?? false },
              ],
            }],
          }],
        },
      },
      { local_id: 'Approved', oid: s('end-yes'), version: '1.0.0', last_modified_date: lastModified, step_type: 'END' },
      { local_id: 'Rejected', oid: s('end-no'), version: '1.0.0', last_modified_date: lastModified, step_type: 'END' },
    ],
    connections: [
      { from_step_id: s('start'), to_step_id: s('form') },
      { from_step_id: s('form'), to_step_id: s('gate') },
      { from_step_id: s('gate'), to_step_id: s('end-yes'), source_handle_id: 'yes' },
      { from_step_id: s('gate'), to_step_id: s('end-no'), source_handle_id: 'no' },
    ],
    children: [],
  };
  const zip = new AdmZip();
  zip.addFile(`${root.local_id}.WFmaster`, Buffer.from(JSON.stringify(root), 'utf8'));
  return { name: `${opts.oid}-v${version}-esig.WFmasterX`, mimeType: MIME, buffer: zip.toBuffer() };
}

// Auto-claim phase 4 (spec 2026-08-14 §7, e2e bullet). Parent scope:
//   START → "Fill Details" (USER_INTERACTION, form: Reason) → "Compute" (SCRIPT with no
//   source — an engine-internal non-UI step between two UI steps; the chain must survive
//   it, D1) → "Split" (PARALLEL) → "Check A" + "Check B" (doc-less USER_INTERACTION, the
//   Cockpit renders a bare Continue; both must auto-claim, D3) → "Join" (WAIT ALL) →
//   "Review" (WORKFLOW PROXY — its local_id equals the child spec's local_id, which is the
//   engine's lookup key, transition.ts activateWorkflowProxy) → "Wrap Up" (doc-less) → END.
// Child scope "Review": START → "Review Details" (form: Verdict) → "Approve Review"
//   (doc-less) → END. The child's first step is a fresh scope (D6: offered, not chained);
//   the spec restricts the child NODE's allowed roles in CM so it is a real role boundary.
// Envelope/zip mechanics mirror uiWorkflowPackage exactly.
export function chainWorkflowPackage(opts: { localId: string; oid: string; version?: string }): FilePayload {
  const version = opts.version ?? '1.0.0';
  const lastModified = '2026-01-01T00:00:00Z';
  const s = (suffix: string) => `${opts.oid}-${suffix}`;
  const step = (localId: string, oid: string, stepType: string, extra: Record<string, unknown> = {}) => ({
    local_id: localId, oid, version: '1.0.0', last_modified_date: lastModified, step_type: stepType, ...extra,
  });
  const textForm = (fieldName: string, label: string, outputParameter: string) => ({
    version: 2,
    sections: [{
      id: 'sec1', role: 'content',
      rows: [{
        id: 'r1',
        blocks: [{ id: 'b1', type: 'textInput', fieldName, label, required: true, outputParameter }],
      }],
    }],
  });
  const child = {
    local_id: 'Review', oid: s('review'), version, last_modified_date: lastModified,
    state: 'Effective', schemaVersion: '5.0', parentChildSpecId: null,
    steps: [
      step('Begin Review', s('c-start'), 'START'),
      step('Review Details', s('c-form'), 'USER_INTERACTION', {
        output_parameter_specifications: [{ id: 'op-verdict', default_value: '', target: 'Review.Verdict' }],
        form_document: textForm('verdict', 'Verdict', 'op-verdict'),
      }),
      step('Approve Review', s('c-approve'), 'USER_INTERACTION'),
      step('Review Done', s('c-end'), 'END'),
    ],
    connections: [
      { from_step_id: s('c-start'), to_step_id: s('c-form') },
      { from_step_id: s('c-form'), to_step_id: s('c-approve') },
      { from_step_id: s('c-approve'), to_step_id: s('c-end') },
    ],
    children: [],
  };
  const root = {
    local_id: opts.localId, oid: opts.oid, version, last_modified_date: lastModified,
    state: 'Effective', schemaVersion: '5.0',
    steps: [
      step('Begin', s('start'), 'START'),
      step('Fill Details', s('form'), 'USER_INTERACTION', {
        output_parameter_specifications: [{ id: 'op-reason', default_value: '', target: 'Result.Reason' }],
        form_document: textForm('reason', 'Reason', 'op-reason'),
      }),
      step('Compute', s('script'), 'SCRIPT'),
      step('Split', s('split'), 'PARALLEL'),
      step('Check A', s('check-a'), 'USER_INTERACTION'),
      step('Check B', s('check-b'), 'USER_INTERACTION'),
      step('Join', s('join'), 'WAIT ALL'),
      step('Review', s('proxy'), 'WORKFLOW PROXY'),
      step('Wrap Up', s('wrap'), 'USER_INTERACTION'),
      step('Done', s('end'), 'END'),
    ],
    connections: [
      { from_step_id: s('start'), to_step_id: s('form') },
      { from_step_id: s('form'), to_step_id: s('script') },
      { from_step_id: s('script'), to_step_id: s('split') },
      { from_step_id: s('split'), to_step_id: s('check-a') },
      { from_step_id: s('split'), to_step_id: s('check-b') },
      { from_step_id: s('check-a'), to_step_id: s('join') },
      { from_step_id: s('check-b'), to_step_id: s('join') },
      { from_step_id: s('join'), to_step_id: s('proxy') },
      { from_step_id: s('proxy'), to_step_id: s('wrap') },
      { from_step_id: s('wrap'), to_step_id: s('end') },
    ],
    children: [child],
  };
  const zip = new AdmZip();
  zip.addFile(`${root.local_id}.WFmaster`, Buffer.from(JSON.stringify(root), 'utf8'));
  return { name: `${opts.oid}-v${version}-chain.WFmasterX`, mimeType: MIME, buffer: zip.toBuffer() };
}

// Auto-claim phase 4, release scenario — one scope, no child:
//   START → "Step One" (form: Reason) → "Split" (PARALLEL) → "Two A" + "Two B" (doc-less
//   USER_INTERACTION, both chain to the claimant) → "Join" (WAIT ALL) → "Step Three"
//   (doc-less) → END.
// The spec claims Step One by hand, lets Two A / Two B chain, RELEASES Two A, then submits
// Two B — that submit's reconcile pass runs while Two A is a released offer, which is the
// only way a live system can attempt to re-steal it (D5: only newly-inserted offers auto-claim;
// a released row must stay offered). Re-claiming Two A and completing it then lets Step Three
// chain again (whoever claims and completes the next step in the scope is the chain user).
export function chainReleaseWorkflowPackage(opts: { localId: string; oid: string; version?: string }): FilePayload {
  const version = opts.version ?? '1.0.0';
  const lastModified = '2026-01-01T00:00:00Z';
  const s = (suffix: string) => `${opts.oid}-${suffix}`;
  const step = (localId: string, oid: string, stepType: string, extra: Record<string, unknown> = {}) => ({
    local_id: localId, oid, version: '1.0.0', last_modified_date: lastModified, step_type: stepType, ...extra,
  });
  const root = {
    local_id: opts.localId, oid: opts.oid, version, last_modified_date: lastModified,
    state: 'Effective', schemaVersion: '5.0',
    steps: [
      step('Begin', s('start'), 'START'),
      step('Step One', s('one'), 'USER_INTERACTION', {
        output_parameter_specifications: [{ id: 'op-reason', default_value: '', target: 'Result.Reason' }],
        form_document: {
          version: 2,
          sections: [{
            id: 'sec1', role: 'content',
            rows: [{
              id: 'r1',
              blocks: [{ id: 'b1', type: 'textInput', fieldName: 'reason', label: 'Reason', required: true, outputParameter: 'op-reason' }],
            }],
          }],
        },
      }),
      step('Split', s('split'), 'PARALLEL'),
      step('Two A', s('two-a'), 'USER_INTERACTION'),
      step('Two B', s('two-b'), 'USER_INTERACTION'),
      step('Join', s('join'), 'WAIT ALL'),
      step('Step Three', s('three'), 'USER_INTERACTION'),
      step('Done', s('end'), 'END'),
    ],
    connections: [
      { from_step_id: s('start'), to_step_id: s('one') },
      { from_step_id: s('one'), to_step_id: s('split') },
      { from_step_id: s('split'), to_step_id: s('two-a') },
      { from_step_id: s('split'), to_step_id: s('two-b') },
      { from_step_id: s('two-a'), to_step_id: s('join') },
      { from_step_id: s('two-b'), to_step_id: s('join') },
      { from_step_id: s('join'), to_step_id: s('three') },
      { from_step_id: s('three'), to_step_id: s('end') },
    ],
    children: [],
  };
  const zip = new AdmZip();
  zip.addFile(`${root.local_id}.WFmaster`, Buffer.from(JSON.stringify(root), 'utf8'));
  return { name: `${opts.oid}-v${version}-chain-release.WFmasterX`, mimeType: MIME, buffer: zip.toBuffer() };
}

export function environmentPackage(opts: {
  localId: string; oid: string; version?: string; state?: string; libraryName?: string; libraryOid?: string;
  // Phase 3 (shared-state e2e): declarations the load materializes into the work-center
  // registry (mission-control-db dao/work-center-runtime.ts readRegistrySource's shapes).
  resources?: Array<{ name: string; resource_type: string; use_limit?: number; names?: string[]; description?: string }>;
  valueProperties?: Array<{ name: string; entries: Array<{ name: string; value: string }> }>;
}): FilePayload {
  const version = opts.version ?? '1.0.0';
  const env = {
    local_id: opts.localId, oid: opts.oid, version,
    state: opts.state ?? 'Effective', schemaVersion: '5.0',
    library_name: opts.libraryName ?? 'Default',
    ...(opts.libraryOid ? { library_oid: opts.libraryOid } : {}),
    included_actions: [],
    ...(opts.resources ? { resource_property_specifications: opts.resources } : {}),
    ...(opts.valueProperties ? { value_property_specifications: opts.valueProperties } : {}),
  };
  const zip = new AdmZip();
  zip.addFile(`${env.local_id}.WFenvir`, Buffer.from(JSON.stringify(env), 'utf8'));
  return { name: `${opts.oid}-v${version}.WFenvirX`, mimeType: MIME, buffer: zip.toBuffer() };
}

// Phase 4b (shared-resources.spec.ts): a live-engine workflow that CONTENDS. The root embeds its
// environment spec (ingest/wfmasterx.ts links it and the same insert site materializes the
// registry — spec S8), declares its own workflow-scoped `Lock`, and parks at a USER_INTERACTION
// that acquired both on entry — so RW-1 holds `Printer` until an operator acts, and RW-2 queues
// behind it. Command shapes mirror MissionEngine/test/real-pg.engine.test.ts's
// t7ParkAcquireReleaseSpec (the full-validation path): `included_actions: []` is REQUIRED on the
// embedded env; a USER_INTERACTION with no form_document validates and parks (needsUserAction).
// `resource_source_type: 'environment'` is explicit on the environment commands so
// mission-control-db/src/runtime/instantiate.ts's remap leaves their oid alone (it remaps only
// workflow-scoped sources; the workflow oid on the Lock commands IS remapped to the rt_ oid,
// which is what keys the instance's own pool).
export function sharedResourceWorkflowPackage(opts: { localId: string; oid: string; envOid: string; version?: string }): FilePayload {
  const version = opts.version ?? '1.0.0';
  const lastModified = '2026-01-01T00:00:00Z';
  const s = (suffix: string) => `${opts.oid}-${suffix}`;
  const env = { command_type: '', resource_name: 'Printer', resource_source_oid: opts.envOid, resource_source_type: 'environment' };
  const lock = { command_type: '', resource_name: 'Lock', resource_source_oid: opts.oid };
  const root = {
    local_id: opts.localId, oid: opts.oid, version, last_modified_date: lastModified,
    state: 'Effective', schemaVersion: '5.0',
    resource_property_specifications: [{ name: 'Lock', resource_type: 'binary exclusive use' }],
    environment_specifications: [{
      local_id: 'E2E Shared Res Env', oid: opts.envOid, version: '1.0.0', last_modified_date: lastModified, state: 'Effective',
      included_actions: [],
      resource_property_specifications: [{ name: 'Printer', resource_type: 'binary exclusive use' }],
      value_property_specifications: [{ name: 'Batch', entries: [{ name: 'Size', value: '5' }] }],
    }],
    steps: [
      { local_id: 'Begin', oid: s('start'), version: '1.0.0', last_modified_date: lastModified, step_type: 'START' },
      {
        local_id: 'Use Printer', oid: s('use'), version: '1.0.0', last_modified_date: lastModified, step_type: 'USER_INTERACTION',
        resource_command_specifications: [
          { ...env, command_type: 'Acquire' }, { ...lock, command_type: 'Acquire' },
          { ...env, command_type: 'Release' }, { ...lock, command_type: 'Release' },
        ],
      },
      { local_id: 'Done', oid: s('end'), version: '1.0.0', last_modified_date: lastModified, step_type: 'END' },
    ],
    connections: [{ from_step_id: s('start'), to_step_id: s('use') }, { from_step_id: s('use'), to_step_id: s('end') }],
    children: [],
  };
  const zip = new AdmZip();
  zip.addFile(`${root.local_id}.WFmaster`, Buffer.from(JSON.stringify(root), 'utf8'));
  return { name: `${opts.oid}-v${version}-shared.WFmasterX`, mimeType: MIME, buffer: zip.toBuffer() };
}

// Timed GATE (spec 2026-10-13): START → GATE "Hold" (timer, delaySeconds) → END. A NEW builder,
// so no existing caller's zip bytes change.
export function timedGateWorkflowPackage(opts: { localId: string; oid: string; delaySeconds: number }): FilePayload {
  const version = '1.0.0';
  const lastModified = '2026-01-01T00:00:00Z';
  const s = (suffix: string) => `${opts.oid}-${suffix}`;
  const root = {
    local_id: opts.localId, oid: opts.oid, version, last_modified_date: lastModified,
    state: 'Effective', schemaVersion: '5.0',
    steps: [
      { local_id: 'Begin', oid: s('start'), version: '1.0.0', last_modified_date: lastModified, step_type: 'START' },
      {
        local_id: 'Hold', oid: s('gate'), version: '1.0.0', last_modified_date: lastModified, step_type: 'GATE',
        gate_config: { mode: 'timer', delay_seconds: opts.delaySeconds },
      },
      { local_id: 'Done', oid: s('end'), version: '1.0.0', last_modified_date: lastModified, step_type: 'END' },
    ],
    connections: [
      { from_step_id: s('start'), to_step_id: s('gate') },
      { from_step_id: s('gate'), to_step_id: s('end') },
    ],
    children: [],
  };
  const zip = new AdmZip();
  zip.addFile(`${root.local_id}.WFmaster`, Buffer.from(JSON.stringify(root), 'utf8'));
  return { name: `${opts.oid}-v${version}-timed.WFmasterX`, mimeType: MIME, buffer: zip.toBuffer() };
}

// Repeating SCRIPT (spec 2026-10-13 §6): START → SCRIPT "Poll" (repeat) → END. A NEW builder, so no
// existing caller's zip bytes change.
export function repeatingScriptWorkflowPackage(opts: { localId: string; oid: string; source: string; cycleSeconds: number }): FilePayload {
  const version = '1.0.0';
  const lastModified = '2026-01-01T00:00:00Z';
  const s = (suffix: string) => `${opts.oid}-${suffix}`;
  const root = {
    local_id: opts.localId, oid: opts.oid, version, last_modified_date: lastModified,
    state: 'Effective', schemaVersion: '5.0',
    steps: [
      { local_id: 'Begin', oid: s('start'), version: '1.0.0', last_modified_date: lastModified, step_type: 'START' },
      {
        local_id: 'Poll', oid: s('script'), version: '1.0.0', last_modified_date: lastModified, step_type: 'SCRIPT',
        script_config: { language: 'javascript', source: opts.source, repeat: { cycle_seconds: opts.cycleSeconds } },
      },
      { local_id: 'Done', oid: s('end'), version: '1.0.0', last_modified_date: lastModified, step_type: 'END' },
    ],
    connections: [
      { from_step_id: s('start'), to_step_id: s('script') },
      { from_step_id: s('script'), to_step_id: s('end') },
    ],
    children: [],
  };
  const zip = new AdmZip();
  zip.addFile(`${root.local_id}.WFmaster`, Buffer.from(JSON.stringify(root), 'utf8'));
  return { name: `${opts.oid}-v${version}-repeat.WFmasterX`, mimeType: MIME, buffer: zip.toBuffer() };
}

// Distributed Workflow actions (spec 2026-10-15). The parent embeds the
// "Distributed Workflow Management" environment (oid e2e-dwm-env) — bind that oid to
// http://localhost:3007 on the work center. Loose matching (the default) resolves each step by
// environment + action NAME against the service's capabilities.
const DWM_ENV = {
  local_id: 'Distributed Workflow Management', oid: 'e2e-dwm-env', version: '1.0.0', state: 'Effective', last_modified_date: '2026-01-01T00:00:00Z',
  included_actions: [
    'Create and Start Runtime Workflow', 'Wait for Runtime Workflow', 'Get Runtime Workflow Outputs',
    'Suspend Runtime Workflow', 'Unsuspend Runtime Workflow', 'Stop Runtime Workflow', 'Abort Runtime Workflow',
  ].map((action_name) => ({ action_name, action_oid: `e2e-${action_name}`, action_library: 'Distributed Workflow Action Library' })),
};

export function dwmChildWorkflowPackage(opts: { localId: string; oid: string }): FilePayload {
  const lm = '2026-01-01T00:00:00Z';
  const s = (x: string) => `${opts.oid}-${x}`;
  const root = {
    local_id: opts.localId, oid: opts.oid, version: '1.0.0', last_modified_date: lm, state: 'Effective', schemaVersion: '5.0',
    starting_parameter_specifications: [{ id: 'Note', default_value: '' }],
    output_parameter_specifications: [{ id: 'Echo', target: 'Echo' }],
    steps: [
      { local_id: 'Begin', oid: s('start'), version: '1.0.0', last_modified_date: lm, step_type: 'START' },
      { local_id: 'Echo', oid: s('script'), version: '1.0.0', last_modified_date: lm, step_type: 'SCRIPT',
        script_config: { language: 'javascript', source: "output.Echo = Note + '!';" },
        input_parameter_specifications: [{ id: 'Note', default_value: 'Note', value_type: 'property' }],
        output_parameter_specifications: [{ id: 'Echo', target: 'Echo' }] },
      { local_id: 'Done', oid: s('end'), version: '1.0.0', last_modified_date: lm, step_type: 'END' },
    ],
    connections: [{ from_step_id: s('start'), to_step_id: s('script') }, { from_step_id: s('script'), to_step_id: s('end') }],
    children: [],
  };
  const zip = new AdmZip();
  zip.addFile(`${root.local_id}.WFmaster`, Buffer.from(JSON.stringify(root), 'utf8'));
  return { name: `${opts.oid}-v1.0.0.WFmasterX`, mimeType: MIME, buffer: zip.toBuffer() };
}

export function dwmParentWorkflowPackage(opts: { localId: string; oid: string; childName: string; workCenter: string }): FilePayload {
  const lm = '2026-01-01T00:00:00Z';
  const s = (x: string) => `${opts.oid}-${x}`;
  const action = (oidSuffix: string, name: string, inputs: object[], outputs: object[]) => ({
    local_id: name, oid: s(oidSuffix), version: '1.0.0', last_modified_date: lm, step_type: 'ACTION PROXY',
    action_proxy_config: { action_oid: `e2e-${name}`, environment_oid: DWM_ENV.oid, action_name: name, environment_name: DWM_ENV.local_id, timeout_ms: 60000 },
    input_parameter_specifications: inputs, output_parameter_specifications: outputs,
  });
  const root = {
    local_id: opts.localId, oid: opts.oid, version: '1.0.0', last_modified_date: lm, state: 'Effective', schemaVersion: '5.0',
    environment_specifications: [DWM_ENV],
    value_property_specifications: [
      { name: 'Child', entries: [{ name: 'ID', value: '' }, { name: 'Label', value: '' }] },
      { name: 'Made', entries: [{ name: 'Code', value: '' }] },
      { name: 'MadeError', entries: [{ name: 'Text', value: '' }] },
      { name: 'ChildEnd', entries: [{ name: 'State', value: '' }] },
      { name: 'ChildOut', entries: [] },
    ],
    steps: [
      { local_id: 'Begin', oid: s('start'), version: '1.0.0', last_modified_date: lm, step_type: 'START' },
      action('create', 'Create and Start Runtime Workflow', [
        { id: 'WorkCenter', default_value: opts.workCenter },
        { id: 'Workflow', default_value: opts.childName },
        { id: 'StartingParameters', default_value: 'Note=hello' },
      ], [{ id: 'RuntimeWorkflow', target: 'Child' }, { id: 'Completion', target: 'Made' }, { id: 'Error', target: 'MadeError' }]),
      action('wait', 'Wait for Runtime Workflow',
        [{ id: 'RuntimeWorkflow', default_value: 'Child.ID', value_type: 'property' }],
        [{ id: 'Runtime', target: 'ChildEnd' }]),
      action('outputs', 'Get Runtime Workflow Outputs',
        [{ id: 'RuntimeWorkflow', default_value: 'Child.ID', value_type: 'property' }],
        [{ id: 'Outputs', target: 'ChildOut' }]),
      { local_id: 'Done', oid: s('end'), version: '1.0.0', last_modified_date: lm, step_type: 'END' },
    ],
    connections: [
      { from_step_id: s('start'), to_step_id: s('create') },
      { from_step_id: s('create'), to_step_id: s('wait') },
      { from_step_id: s('wait'), to_step_id: s('outputs') },
      { from_step_id: s('outputs'), to_step_id: s('end') },
    ],
    children: [],
  };
  const zip = new AdmZip();
  zip.addFile(`${root.local_id}.WFmaster`, Buffer.from(JSON.stringify(root), 'utf8'));
  return { name: `${opts.oid}-v1.0.0.WFmasterX`, mimeType: MIME, buffer: zip.toBuffer() };
}

// Spec 2026-10-19 §D: a parent whose steps run in a line (Begin → steps → Done). ACTION PROXY
// steps carry no timeout_ms (no time limit) unless a wait sets timeoutMs.
export type DwmStep =
  | { kind: 'createStart'; id: string; workflow: string; workCenter: string; into: string }
  | { kind: 'verb'; id: string; action: 'Suspend Runtime Workflow' | 'Unsuspend Runtime Workflow' | 'Stop Runtime Workflow' | 'Abort Runtime Workflow'; target: string; into: string }
  | { kind: 'wait'; id: string; target: string; into: string; timeoutMs?: number }
  | { kind: 'hold'; id: string; seconds: number };

export function dwmScriptedParentPackage(opts: { localId: string; oid: string; steps: DwmStep[] }): FilePayload {
  const lm = '2026-01-01T00:00:00Z';
  const s = (x: string) => `${opts.oid}-${x}`;
  const action = (id: string, name: string, inputs: object[], outputs: object[], timeoutMs?: number) => ({
    local_id: id, oid: s(id), version: '1.0.0', last_modified_date: lm, step_type: 'ACTION PROXY',
    action_proxy_config: {
      action_oid: `e2e-${name}`, environment_oid: DWM_ENV.oid, action_name: name, environment_name: DWM_ENV.local_id,
      ...(timeoutMs !== undefined ? { timeout_ms: timeoutMs } : {}),
    },
    input_parameter_specifications: inputs, output_parameter_specifications: outputs,
  });
  const props = new Map<string, string[]>();
  const prop = (name: string, entries: string[]) => { props.set(name, entries); };
  const steps = opts.steps.map((st) => {
    switch (st.kind) {
      case 'createStart':
        prop(st.into, ['ID', 'Label']); prop(`${st.into}Made`, ['Code']); prop(`${st.into}Error`, ['Text']);
        return action(st.id, 'Create and Start Runtime Workflow', [
          { id: 'WorkCenter', default_value: st.workCenter },
          { id: 'Workflow', default_value: st.workflow },
          { id: 'StartingParameters', default_value: '' },
        ], [
          { id: 'RuntimeWorkflow', target: st.into },
          { id: 'Completion', target: `${st.into}Made` },
          { id: 'Error', target: `${st.into}Error` },
        ]);
      case 'verb':
        prop(st.into, ['Code']); prop(`${st.into}Error`, ['Text']);
        return action(st.id, st.action,
          [{ id: 'RuntimeWorkflow', default_value: `${st.target}.ID`, value_type: 'property' }],
          [{ id: 'Completion', target: st.into }, { id: 'Error', target: `${st.into}Error` }]);
      case 'wait':
        prop(st.into, ['State']);
        return action(st.id, 'Wait for Runtime Workflow',
          [{ id: 'RuntimeWorkflow', default_value: `${st.target}.ID`, value_type: 'property' }],
          [{ id: 'Runtime', target: st.into }], st.timeoutMs);
      case 'hold':
        return {
          local_id: st.id, oid: s(st.id), version: '1.0.0', last_modified_date: lm, step_type: 'GATE',
          gate_config: { mode: 'timer', delay_seconds: st.seconds },
        };
    }
  });
  const chain = [s('start'), ...opts.steps.map((st) => s(st.id)), s('end')];
  const root = {
    local_id: opts.localId, oid: opts.oid, version: '1.0.0', last_modified_date: lm, state: 'Effective', schemaVersion: '5.0',
    environment_specifications: [DWM_ENV],
    value_property_specifications: [...props].map(([name, entries]) => ({ name, entries: entries.map((e) => ({ name: e, value: '' })) })),
    steps: [
      { local_id: 'Begin', oid: s('start'), version: '1.0.0', last_modified_date: lm, step_type: 'START' },
      ...steps,
      { local_id: 'Done', oid: s('end'), version: '1.0.0', last_modified_date: lm, step_type: 'END' },
    ],
    connections: chain.slice(1).map((to, i) => ({ from_step_id: chain[i], to_step_id: to })),
    children: [],
  };
  const zip = new AdmZip();
  zip.addFile(`${root.local_id}.WFmaster`, Buffer.from(JSON.stringify(root), 'utf8'));
  return { name: `${opts.oid}-v1.0.0.WFmasterX`, mimeType: MIME, buffer: zip.toBuffer() };
}
