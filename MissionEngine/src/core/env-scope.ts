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
// Which tier owns a resource command (spec §5.2). Kept in its own file (rather than inline in
// context.ts or transition.ts) so the rule has ONE home and can be unit-tested without a
// database or a WorkflowContext — Task 3 (openContext / envResourceNames, which computes the
// registry LOCK SET) and Task 4 (routing attemptResourceCommands/
// releaseResourceCompletionCommands/resumeGrantedSteps, which decides where a command's grant
// actually lands) both consume it from here, calling the SAME function over the SAME
// EnvironmentScope, so lock set and routing set can never drift apart from each other.
//
// Task 3 review fix (Important 1): the first cut of this rule keyed on
// `resource_source_type`, an OPTIONAL, ADVISORY field (spec/types.ts) with zero fixture
// evidence for the environment branch — every conformance fixture's resource commands carry
// `"workflow"`. The engine's actual routing (transition.ts's buildResourceKey) and the
// validator's OWNERSHIP check (validator.ts's gatherOwners/validateSpecSteps) both key on
// `resource_source_oid` (defaulting to the owning spec's own oid), so a validated package that
// sets `resource_source_oid` to point at a declared environment but omits the optional
// `resource_source_type` used to silently produce an EMPTY lock set — Phase 2a hydration never
// ran, and the resource kept being served per-instance. This file now keys on the OID, matching
// what the validator already enforces resolves to a real workflow-or-environment owner.
import type { MasterWorkflowSpecification, ResourceCommandSpecification } from '../spec/types.js';

/** Every `environment_specifications[].oid` reachable in a frozen recipe (root + every nested
 *  child, at any depth), plus every resource name any of THOSE environment specs declares in
 *  its own `resource_property_specifications`. Computed once per recipe (`collectEnvironmentScope`,
 *  below) and shared: `openContext` stores it on `WorkflowContext.envScope` so Task 4's routing
 *  reads the identical value `envResourceNames` (below) used to compute the lock set, rather
 *  than recomputing its own copy that could drift. */
export interface EnvironmentScope {
  oids: ReadonlySet<string>;
  declaredNames: ReadonlySet<string>;
}

/** Walk `spec` (root + every nested `.children` entry, any depth — the same shape
 *  `envResourceNames` walks) collecting every environment spec's oid and every resource name
 *  it declares. Pure and synchronous: no DB read, so it can run in `WorkflowContext`'s
 *  constructor, before any hydration. */
export function collectEnvironmentScope(spec: MasterWorkflowSpecification): EnvironmentScope {
  const oids = new Set<string>();
  const declaredNames = new Set<string>();
  const walk = (s: MasterWorkflowSpecification): void => {
    for (const env of s.environment_specifications ?? []) {
      oids.add(env.oid);
      for (const r of env.resource_property_specifications ?? []) declaredNames.add(r.name);
    }
    for (const child of s.children ?? []) walk(child);
  };
  walk(spec);
  return { oids, declaredNames };
}

/**
 * Ordered rules:
 *   1. `(cmd.resource_source_oid ?? owningSpec.oid)` — the exact value transition.ts's
 *      buildResourceKey and the validator's ownership check both resolve to — names a spec in
 *      `scope.oids`: environment.
 *   2. Otherwise, an explicit (but oid-less, or oid-mismatched) `resource_source_type:
 *      'environment'` is trusted ONLY when the command's resource_name is genuinely declared by
 *      one of the environment specs the recipe carries (`scope.declaredNames`) — this must never
 *      WIDEN routing past what hydration actually locked, so an unrecognized name still falls
 *      through to workflow-scoped handling (rule 3) rather than being taken on faith.
 *   3. Otherwise workflow, so the pre-existing "Resource is not registered" throw fires
 *      unchanged rather than this function inventing a new failure mode.
 *
 * A registry-derived fallback (this file's first cut had one) cannot work here: any name it
 * could add is already reachable through rule 1 or 2 above (both are pure functions of the
 * frozen recipe, computed BEFORE the registry is ever locked), and a name outside this scope
 * would route to a manager `openContext` never hydrated for it.
 */
export function isEnvironmentCommand(
  cmd: ResourceCommandSpecification,
  owningSpec: MasterWorkflowSpecification,
  scope: EnvironmentScope,
): boolean {
  const sourceOid = cmd.resource_source_oid ?? owningSpec.oid;
  if (scope.oids.has(sourceOid)) return true;
  if (cmd.resource_source_type === 'environment' && scope.declaredNames.has(cmd.resource_name)) return true;
  return false;
}
