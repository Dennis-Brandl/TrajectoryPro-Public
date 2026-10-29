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

import { memo, useMemo } from 'react'
import { withCanonicalCatchOutputs, CATCH_OUTPUT_NAMES } from '@/lib/catch-outputs'
import type { ParameterSpec } from '@/types/nodes'

interface CatchOutputsListProps {
  outputs: ParameterSpec[]
}

/**
 * Read-only list of a CATCH step's output parameters. The four canonical
 * trigger-info outputs (Message, Reason, Step, StepID) are runtime-supplied
 * and fixed — no add/remove/edit. Rows from older workflows that carry an
 * explicitly bound Value Property target keep it; it is shown read-only.
 */
function CatchOutputsListComponent({ outputs }: CatchOutputsListProps) {
  // Display-only canonical ordering (stray non-canonical rows last) — the
  // persisted/exported row order is left untouched.
  const rows = useMemo(() => {
    const order = (name: string) => {
      const i = (CATCH_OUTPUT_NAMES as readonly string[]).indexOf(name)
      return i === -1 ? CATCH_OUTPUT_NAMES.length : i
    }
    return [...withCanonicalCatchOutputs(outputs)].sort((a, b) => order(a.name) - order(b.name))
  }, [outputs])
  return (
    <div className="space-y-2">
      {rows.map((output) => (
        <div key={output.name} className="space-y-0.5">
          <div className="text-sm font-medium px-1">{output.name}</div>
          {output.target && output.target !== output.name && (
            <div className="text-xs text-slate-500 dark:text-slate-400 px-1">→ {output.target}</div>
          )}
          {output.description && (
            <div className="text-xs text-slate-500 dark:text-slate-400 px-1">{output.description}</div>
          )}
        </div>
      ))}
    </div>
  )
}

export const CatchOutputsList = memo(CatchOutputsListComponent)
