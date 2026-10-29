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

/** A flat-store key read the way the engine's PropertyStore.resolvePropertyKey reads it
 *  (MissionEngine/src/core/properties.ts): the exact key; else, when the key names a whole Value
 *  Property held only as dotted entries ("Batch.Yield", ...), every `key.` entry except
 *  Description (case-insensitive) as JSON `[{"name":"Yield","value":"97"}, ...]`, the name being
 *  everything after the first `key.`; else undefined. */
function resolveFlatKey(props: Record<string, string>, key: string): string | undefined {
  const exact = props[key];
  if (exact !== undefined) return exact;
  const prefix = key + '.';
  const entries: Array<{ name: string; value: string }> = [];
  for (const [k, v] of Object.entries(props)) {
    if (!k.startsWith(prefix)) continue;
    const name = k.substring(prefix.length);
    if (name.toLowerCase() === 'description') continue;
    entries.push({ name, value: v });
  }
  return entries.length > 0 ? JSON.stringify(entries) : undefined;
}

/** A workflow's own output parameters, valued from its flat property store — what runtime
 *  history records and what Get Runtime Workflow Outputs returns (spec 2026-10-15 §6.2).
 *  Each output reads its `target` key (Designer exports `target: output.target || output.name`),
 *  falling back to its id, then ''; a target naming a whole Value Property resolves like the
 *  engine's whole-property input (resolveFlatKey). This is NOT what an in-engine parent WORKFLOW
 *  PROXY receives: completeChildWorkflow (MissionEngine/src/core/transition.ts) reads the child's
 *  property map by output id only. Junk entries are skipped, never fatal. */
export function workflowOutputs(spec: unknown, props: Record<string, string>): Array<{ name: string; value: string }> {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return [];
  const specs = (spec as { output_parameter_specifications?: unknown }).output_parameter_specifications;
  if (!Array.isArray(specs)) return [];
  const out: Array<{ name: string; value: string }> = [];
  for (const p of specs) {
    if (!p || typeof p !== 'object') continue;
    const { id, target } = p as { id?: unknown; target?: unknown };
    if (typeof id !== 'string' || id === '') continue;
    const key = typeof target === 'string' && target !== '' ? target : id;
    out.push({ name: id, value: resolveFlatKey(props, key) ?? props[id] ?? '' });
  }
  return out;
}
