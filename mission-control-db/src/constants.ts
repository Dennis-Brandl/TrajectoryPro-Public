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

// The interactive step types the app indexes and role-scopes. Lives here (not in ingest/)
// so DAO code can reference it without importing up into the ingest layer.
export const UI_STEP_TYPES = new Set(['USER_INTERACTION', 'YES_NO']);

// States in which a reloaded package replaces the stored copy in place. Stored without
// spaces (the Designer's "In Test" / "In Review" arrive as InTest / InReview). Every other
// state is released and keeps the already_present no-op rule.
export const RELOADABLE_STATES: ReadonlySet<string> = new Set(['Draft', 'InTest', 'InReview']);
export function isReloadableState(state: string): boolean {
  return RELOADABLE_STATES.has(state);
}
