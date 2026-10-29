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

import type { CatchTrigger } from '@/lib/canvas/findCatchTriggers'

interface Props {
  triggers: CatchTrigger[]
  onSelect: (stepId: string) => void
}

/** Read-only "Triggered by" list for a CATCH: which TRY (step + mode) routes here. */
export function CatchTriggeredBy({ triggers, onSelect }: Props) {
  return (
    <section className="mt-3 border-t pt-3">
      <h4 className="text-xs font-semibold text-muted-foreground">Triggered by ({triggers.length})</h4>
      {triggers.length === 0 ? (
        <p className="mt-1 text-[10px] text-amber-600">Not referenced by any TRY</p>
      ) : (
        <ul role="list" className="mt-1 space-y-1">
          {triggers.map((t) => (
            <li role="listitem" key={`${t.stepId}:${t.mode}`}>
              <button
                type="button"
                onClick={() => onSelect(t.stepId)}
                className="flex w-full items-center justify-between rounded px-1 py-0.5 text-left text-xs hover:bg-muted"
              >
                <span className="truncate">{t.stepLabel}</span>
                <span className="ml-2 shrink-0 rounded bg-orange-100 px-1 text-[9px] font-mono text-orange-800">
                  ON {t.mode}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
