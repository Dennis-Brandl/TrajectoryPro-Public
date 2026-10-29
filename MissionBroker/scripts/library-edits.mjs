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

export const CODE_TEXT = '0=No error, 1=Other error, 2=Not found, 3=Not permitted, 4=Wrong state, 5=Invalid input';
export const LIBRARY_NAME = 'Distributed Workflow Action Library';

const clone = (o) => JSON.parse(JSON.stringify(o));
const vp = (newId, name, entries) => {
  const id = newId();
  return { id, name, entries: entries.map(([n, v]) => ({ id: newId(), name: n, value: v })) };
};

const NEW_ACTIONS = [
  {
    name: 'Wait for Runtime Workflow',
    description: 'Wait until a Runtime Workflow finishes, then return its final state.',
    outputs: (newId) => [vp(newId, 'Runtime', [['State', ''], ['Description', 'Final state: Completed, Stopped, Aborted or Errored']])],
  },
  {
    name: 'Get Runtime Workflow Outputs',
    description: 'Get the output values of a Runtime Workflow, live or finished.',
    outputs: (newId) => [
      vp(newId, 'Runtime', [['State', ''], ['Description', 'Current or final state']]),
      vp(newId, 'Outputs', [['Description', 'Bind to a whole Value Property: each output of the runtime becomes one of its entries']]),
    ],
  },
];

/** Pure: the edits rulings R5, R8 and R9 make to the GLOBAL library. Returns only real changes,
 *  so a second run is a no-op. */
export function planLibraryEdits(specs, env, newId) {
  const updates = [];
  for (const spec of specs) {
    const data = clone(spec.data);
    let changed = false;
    const completion = (data.outputs ?? []).find((o) => o.name === 'Completion');
    const desc = completion?.entries?.find((e) => e.name === 'Description');
    if (desc && desc.value !== CODE_TEXT) { desc.value = CODE_TEXT; changed = true; }
    if (spec.name === 'Create Runtime Workflow' || spec.name === 'Create and Start Runtime Workflow') {
      const rw = (data.outputs ?? []).find((o) => o.name === 'RuntimeWorkflow');
      if (rw && !rw.entries.some((e) => e.name === 'Label')) {
        const at = rw.entries.findIndex((e) => e.name === 'ID') + 1;
        rw.entries.splice(at, 0, { id: newId(), name: 'Label', value: '' });
        changed = true;
      }
    }
    if (changed) updates.push({ id: spec.id, data });
  }
  const have = new Set(specs.map((s) => s.name));
  const creates = NEW_ACTIONS.filter((a) => !have.has(a.name)).map((a) => ({
    id: crypto.randomUUID(), name: a.name, description: a.description,
    data: {
      nodes: [],
      inputs: [vp(newId, 'RuntimeWorkflow', [['ID', ''], ['Description', 'ID or label of the Runtime Workflow']])],
      outputs: [
        vp(newId, 'Completion', [['Code', ''], ['Description', CODE_TEXT]]),
        vp(newId, 'Error', [['Text', ''], ['Description', '']]),
        ...a.outputs(newId),
      ],
      actionVisibility: 'opaque',
    },
  }));
  const envData = clone(env.data);
  envData.included_actions = envData.included_actions ?? [];
  const listed = new Set(envData.included_actions.map((a) => a.action_name));
  let envChanged = false;
  for (const a of NEW_ACTIONS) {
    if (!listed.has(a.name)) { envData.included_actions.push({ action_name: a.name, action_library: LIBRARY_NAME }); envChanged = true; }
  }
  return { updates, creates, envData: envChanged ? envData : null };
}

/** Pure: refuse to edit anything that is not a lone Draft. The throwaway admin login bypasses
 *  Designer's edit lock (batchSave gate), so this script must check it itself. */
export function assertEditable(specs, env) {
  const problems = [];
  const seen = new Map();
  for (const s of specs) seen.set(s.name, (seen.get(s.name) ?? 0) + 1);
  for (const s of specs) {
    if (s.state !== 'Draft') problems.push(`${s.name} ${s.version ?? ''} is ${s.state ?? 'of unknown state'}, not Draft`.replace('  ', ' '));
  }
  for (const [name, n] of seen) if (n > 1) problems.push(`${name} has ${n} root versions`);
  if (env && env.state !== 'Draft') problems.push(`environment ${env.name ?? env.id} ${env.version ?? ''} is ${env.state ?? 'of unknown state'}, not Draft`.replace('  ', ' '));
  if (problems.length) throw new Error(`refusing to edit, nothing written:\n  ${problems.join('\n  ')}`);
}

/** Pure: why each spec the plan leaves alone gets no update. */
export function skipReasons(specs, updates) {
  const updated = new Set(updates.map((u) => u.id));
  return specs.filter((s) => !updated.has(s.id)).map((s) => {
    const completion = (s.data.outputs ?? []).find((o) => o.name === 'Completion');
    const desc = completion?.entries?.find((e) => e.name === 'Description');
    return { name: s.name, reason: desc ? 'already up to date' : 'no Completion.Description entry' };
  });
}
