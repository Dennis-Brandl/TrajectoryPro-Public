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
import type {
  MasterWorkflowSpecification,
  ParameterDefaultSource,
  ParameterSpecification,
  OutputParameterSpecification,
  FormElement,
} from '../spec/types.js';
import type { SharedPropertyTier } from './shared-properties.js';

/** Pure function to resolve a ParameterDefaultSource against flat maps. */
export function resolveDefaultValue(
  source: ParameterDefaultSource | undefined,
  properties: Record<string, string>,
  inputParameters: Record<string, string>,
): string {
  if (!source) return '';
  if (source.mode === 'static') return source.value;
  if (source.mode === 'property' || source.mode === 'parameter')
    return properties[source.value] ?? '';
  if (source.mode === 'input')
    return inputParameters[source.value] ?? '';
  return '';
}

export class PropertyStore {
  private store = new Map<string, string>();
  private startingParameters = new Map<string, string>();
  private inputParameters = new Map<string, string>();
  /** Work-center-shared tier (spec §5.6). Null when this instance's work center has no shared
   *  values, in which case every path below behaves exactly as it did before this phase. */
  private shared: SharedPropertyTier | null = null;
  /** Property names the OWNING spec declares as its own. A write to one of these stays LOCAL,
   *  preserving today's behavior bit-for-bit.
   *
   *  Bound from the SPEC at context construction, NOT from initializeFromWorkflow: that method
   *  runs only at instance start, child activation and RESTART CLEAN, while every later
   *  transition rebuilds this store through fromJSON — so deriving the set from initialization
   *  would leave it empty and misroute every write on every transition after the first. */
  private declaredLocally = new Set<string>();

  attachShared(tier: SharedPropertyTier | null): void { this.shared = tier; }
  sharedTier(): SharedPropertyTier | null { return this.shared; }

  bindDeclaredNames(workflow: MasterWorkflowSpecification): void {
    // M2 fix: guard `workflow` itself, not just the array property. openContext (context.ts)
    // now runs before instance.ts's validate() call, so a JSON `null` spec reaches here BEFORE
    // the validator has a chance to reject it — `workflow.value_property_specifications` would
    // throw a bare TypeError out of the factory (routing a malformed instance into the
    // start-retry/give-up path) instead of the clean invalid-spec settle validate() produces.
    for (const prop of workflow?.value_property_specifications ?? []) {
      this.declaredLocally.add(prop.name);
    }
  }

  initializeFromWorkflow(workflow: MasterWorkflowSpecification): void {
    const specs = workflow.value_property_specifications;
    if (!specs) return;
    for (const prop of specs) {
      this.declaredLocally.add(prop.name);
      for (const entry of prop.entries) {
        this.store.set(`${prop.name}.${entry.name}`, entry.value);
      }
    }
  }

  initializeFromSetup(initialProperties: Record<string, string>): void {
    for (const [key, value] of Object.entries(initialProperties)) {
      this.store.set(key, value);
    }
  }

  initializeStartingParameters(
    specs: ParameterSpecification[] | undefined,
    values: Record<string, string> | undefined,
  ): void {
    if (!specs) return;
    for (const spec of specs) {
      // Caller-supplied value takes precedence over spec default
      if (values && spec.id in values) {
        this.startingParameters.set(spec.id, values[spec.id]);
      } else {
        // Resolve the default_value based on value_type
        let resolved = spec.default_value;
        if (spec.value_type === 'property') {
          resolved = this.resolvePropertyKey(spec.default_value);
        }
        this.startingParameters.set(spec.id, resolved);
      }
      // Also make starting params available as properties for downstream lookups
      this.store.set(spec.id, this.startingParameters.get(spec.id)!);
    }
  }

  resolveInputParameters(specs: ParameterSpecification[] | undefined): void {
    // A step with no input specs has NO inputs — never a previous step's (the cascade shares one
    // context across steps; spec 2026-09-04 D9 review finding).
    this.inputParameters.clear();
    if (!specs) return;
    for (const spec of specs) {
      let resolved = spec.default_value;
      if (spec.value_type === 'property') {
        resolved = this.resolvePropertyKey(spec.default_value);
      }
      this.inputParameters.set(spec.id, resolved);
    }
  }

  /** Spec 2026-09-04 §5.4.2 (D3): overlay freshly-fetched Action-Property values onto the step's
   *  resolved input parameters, keyed by parameter id. Evaluation-scoped — the instance property
   *  store is never written. */
  applyInputOverlay(overlay: Record<string, string>): void {
    for (const [id, value] of Object.entries(overlay)) this.inputParameters.set(id, value);
  }

  /** Resolve a property key: exact match first, then group prefix fallback.
   *  If the key matches a group (e.g., "DataToSend" with entries "DataToSend.X", "DataToSend.Y"),
   *  returns a JSON array of {name, value} pairs. */
  resolveKey(key: string): string {
    return this.resolvePropertyKey(key);
  }

  private resolvePropertyKey(key: string): string {
    const exact = this.store.get(key);
    if (exact !== undefined) return exact;
    const sharedExact = this.shared?.get(key);
    if (sharedExact !== undefined) return sharedExact;
    // Group prefix: merge both tiers with LOCAL WINNING per entry. Description stays excluded
    // in both — value properties use it for human annotation, never for runtime data.
    const prefix = key + '.';
    const merged = new Map<string, string>();
    for (const e of this.shared?.entriesUnder(key) ?? []) merged.set(e.name, e.value);
    for (const [k, v] of this.store) {
      if (!k.startsWith(prefix)) continue;
      const name = k.substring(prefix.length);
      if (name.toLowerCase() === 'description') continue;
      merged.set(name, v);
    }
    if (merged.size > 0) {
      return JSON.stringify([...merged].map(([name, value]) => ({ name, value })));
    }
    return '';
  }

  get(dotKey: string): string | undefined {
    const local = this.store.get(dotKey);
    if (local !== undefined) return local;
    return this.shared?.get(dotKey);
  }

  set(dotKey: string, value: string): void {
    const split = dotKey.indexOf('.');
    const propertyName = split > 0 ? dotKey.slice(0, split) : dotKey;
    // INVARIANT (I1 fix): for a given store, a key is either local or shared — never both.
    // `declaredLocally` alone does NOT enforce this — it only names the OWNING spec's own
    // declared properties. An existing LOCAL ENTRY for a key the registry also holds counts as
    // local too, because two paths populate `this.store` directly without touching
    // `declaredLocally`: initializeFromSetup (child seeding, transition.ts's WORKFLOW PROXY
    // activation copies the parent's flat map into the child's store) and fromJSON (the
    // per-transition hydrate). Without this check, a key seeded that way reads LOCAL (get()/
    // resolvePropertyKey() prefer local unconditionally) but writes SHARED — the writer loses
    // its own read-back, and worse, a value seeded from a PARENT's PRIVATE local declaration can
    // get published work-center-wide the instant a child (whose own declaredLocally doesn't
    // cover it) writes it.
    if (!this.declaredLocally.has(propertyName) && !this.store.has(dotKey) && this.shared?.has(dotKey)) {
      this.shared.set(dotKey, value);
      return;
    }
    this.store.set(dotKey, value);
  }

  /** Sync-receive write: set bare target, and if data is a JSON [{name,value},...] array
   *  (mirror of resolveKey's group serialization), also explode entries into dotted children
   *  so downstream readers can consume either the full record or individual fields. */
  setSyncTarget(target: string, data: string): void {
    this.set(target, data);
    const entries = parseGroupEntries(data);
    if (!entries) return;
    for (const e of entries) {
      this.set(`${target}.${e.name}`, e.value);
    }
  }

  resolveDefault(defaultSource: ParameterDefaultSource | undefined): string {
    if (!defaultSource) return '';
    if (defaultSource.mode === 'static') return defaultSource.value;
    if (defaultSource.mode === 'property' || defaultSource.mode === 'parameter')
      return this.get(defaultSource.value) ?? '';
    if (defaultSource.mode === 'input')
      return this.inputParameters.get(defaultSource.value)
        ?? this.startingParameters.get(defaultSource.value)
        ?? '';
    return '';
  }

  captureFormOutputs(
    elements: FormElement[],
    formValues: Record<string, unknown>,
    outputSpecs?: OutputParameterSpecification[],
  ): void {
    for (const el of elements) {
      if (!('outputParameter' in el) || !el.outputParameter) continue;
      if (!('fieldName' in el)) continue;
      const fieldName = (el as { fieldName: string }).fieldName;
      const value = formValues[fieldName];
      if (value === undefined) continue;

      // Resolve target: use output_parameter_specifications target if available,
      // otherwise use el.outputParameter directly (which may already be dotted).
      const spec = outputSpecs?.find(s => s.id === el.outputParameter);
      const key = spec?.target || el.outputParameter;

      if (Array.isArray(value)) {
        this.set(key, JSON.stringify(value));
      } else {
        this.set(key, String(value));
      }
    }
  }

  getInputParameters(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of this.inputParameters) {
      result[key] = value;
    }
    // Include starting parameters as fallback
    for (const [key, value] of this.startingParameters) {
      if (!(key in result)) {
        result[key] = value;
      }
    }
    return result;
  }

  toFlatMap(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of this.store) {
      result[key] = value;
    }
    return result;
  }

  /** Serialize the bare property store to a flat record, for persistence into
   *  `workflow_instance.property_store`. Mirrors toFlatMap() but named for the
   *  hydrate/persist round-trip pairing with fromJSON(). */
  toJSON(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of this.store) {
      result[key] = value;
    }
    return result;
  }

  /** Local ON TOP of shared — for `runtime_history.properties` only (plan delta D6). A finished
   *  run's history must record the environment values it actually used, but `property_store`
   *  and child seeding stay strictly local: copying a shared value into a local store would pin
   *  that instance to its copy and it would never see another workflow's update again. */
  toHistoryJSON(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const e of this.shared?.allEntries() ?? []) result[e.dotKey] = e.value;
    for (const [key, value] of this.store) result[key] = value;
    return result;
  }

  /** Hydrate a PropertyStore from a flat record previously produced by toJSON(),
   *  e.g. read back from `workflow_instance.property_store`. startingParameters
   *  and inputParameters are not part of the persisted shape and start empty. */
  static fromJSON(obj: Record<string, string>): PropertyStore {
    const store = new PropertyStore();
    for (const [key, value] of Object.entries(obj)) {
      store.store.set(key, value);
    }
    return store;
  }
}

/** Parse a string as the JSON shape produced by resolveKey's group fallback:
 *  [{"name": string, "value": string}, ...]. Returns null on any deviation. */
function parseGroupEntries(data: string): { name: string; value: string }[] | null {
  if (!data) return null;
  const trimmed = data.trim();
  if (!trimmed.startsWith('[')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  const result: { name: string; value: string }[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') return null;
    const name = (item as { name?: unknown }).name;
    const value = (item as { value?: unknown }).value;
    if (typeof name !== 'string' || typeof value !== 'string') return null;
    result.push({ name, value });
  }
  return result;
}
