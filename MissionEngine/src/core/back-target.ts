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
// Fixed button row (spec 2026-11-11): which screen a Back press returns to. The cascade carries
// a "back target" along each routed connection (EngineState.backFrom): a screen hands its own
// oid to its successors, an automated step passes on the target it was itself given, and a
// split, a join, a START or a sub-workflow boundary clears it — Back is never offered across
// any of those.

/** Step types an operator answers on screen — the steps Back can return to. */
const SCREEN_TYPES = ['USER_INTERACTION', 'YES_NO'];
/** Step types whose successors never inherit a back target. */
const BREAK_TYPES = ['START', 'PARALLEL', 'WAIT ALL', 'WAIT ANY', 'WORKFLOW PROXY'];

/** What a successor of `fromOid` inherits as its back target. `fromType` is canonical (pass
 *  `canonicalStepType(...)`); `fromCarry` is `fromOid`'s own back target; `routedCount` is how
 *  many connections `fromOid` actually routed down this time (more than one is a split). */
export function carriedBackTarget(fromType: string, fromOid: string, fromCarry: string | null | undefined, routedCount: number): string | null {
  if (routedCount > 1) return null;
  if (BREAK_TYPES.includes(fromType)) return null;
  if (SCREEN_TYPES.includes(fromType)) return fromOid;
  return fromCarry ?? null;
}

/** True for a screen step type (USER_INTERACTION / YES_NO). `type` is canonical. */
export function isScreenType(type: string): boolean {
  return SCREEN_TYPES.includes(type);
}

/** True for a join step type (WAIT ALL / WAIT ANY) — a join never has a back target. */
export function isJoinType(type: string): boolean {
  return type === 'WAIT ALL' || type === 'WAIT ANY';
}
