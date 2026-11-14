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
import type { MasterWorkflowStep, ParameterDefaultSource } from '../spec/types.js';
import type { PropertyStore } from './properties.js';

/** A form's property/input-sourced defaults and placeholders, resolved when the step opens.
 *  Keyed by block id; only non-empty values are kept. */
export interface FormSources {
  defaults: Record<string, string>;
  placeholders: Record<string, string>;
}

function sourceOf(value: unknown): ParameterDefaultSource | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { mode, value: v } = value as { mode?: unknown; value?: unknown };
  if (mode !== 'static' && mode !== 'property' && mode !== 'parameter' && mode !== 'input') return undefined;
  return typeof v === 'string' ? { mode, value: v } : undefined;
}

/**
 * User ruling 2026-11-14 (FormKit spec X.3): a form field's default or placeholder that comes
 * from a property or an input parameter is resolved by the engine — the only place that holds
 * property values (local and work-center-shared) — at step activation, and the inbox applies it
 * to the form it ships. Static defaults stay with the host (they need no data); a static
 * placeholderSource is resolved too, so the host only ever reads `placeholder`.
 *
 * Returns undefined when the step has no v2 form or nothing to resolve, so the snapshot of a
 * step without such fields is unchanged.
 */
export function resolveFormSources(stepDef: MasterWorkflowStep, props: PropertyStore): FormSources | undefined {
  const doc = (stepDef as { form_document?: unknown }).form_document as
    | { sections?: Array<{ rows?: Array<{ blocks?: Array<Record<string, unknown>> }> }> }
    | undefined;
  if (!doc || !Array.isArray(doc.sections)) return undefined;
  const defaults: Record<string, string> = {};
  const placeholders: Record<string, string> = {};
  for (const section of doc.sections) {
    if (!Array.isArray(section?.rows)) continue;
    for (const row of section.rows) {
      if (!Array.isArray(row?.blocks)) continue;
      for (const block of row.blocks) {
        const id = block['id'];
        if (typeof id !== 'string') continue;
        const def = sourceOf(block['defaultSource']);
        if (def && def.mode !== 'static') {
          const v = props.resolveDefault(def);
          if (v !== '') defaults[id] = v;
        }
        const ph = sourceOf(block['placeholderSource']);
        if (ph) {
          const v = props.resolveDefault(ph);
          if (v !== '') placeholders[id] = v;
        }
      }
    }
  }
  if (Object.keys(defaults).length === 0 && Object.keys(placeholders).length === 0) return undefined;
  return { defaults, placeholders };
}
