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
import { StateTag } from '@mission/ui';

// The tree leaf's badge. It keys on `state`, NOT on effective-dating: effectiveFrom is
// NULL through both import paths (the import route passes no meta.effectiveFrom, and
// wfenvirx never sets one), so a date-driven badge would never render. A row that DOES
// carry a date (seeded, or set by Runtime) surfaces it on hover instead.
export function StateBadge({ state, effectiveFrom }: { state: string; effectiveFrom: string | null }) {
  return (
    <span className="ml-auto shrink-0">
      <StateTag
        state={state}
        title={effectiveFrom ? `Effective from ${new Date(effectiveFrom).toLocaleDateString()}` : undefined}
      />
    </span>
  );
}
