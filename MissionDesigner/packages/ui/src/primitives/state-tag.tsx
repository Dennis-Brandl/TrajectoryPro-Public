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

import { cn } from '../lib/utils'

const INFO = new Set(['intest', 'inreview'])
const OK = new Set(['approved', 'effective'])

export function StateTag({ state, title }: { state: string; title?: string }) {
  const key = state.toLowerCase()
  return (
    <span
      title={title}
      className={cn(
        'inline-block rounded px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide',
        INFO.has(key)
          ? 'bg-status-info-bg text-status-info-fg'
          : OK.has(key)
            ? 'bg-status-ok-bg text-status-ok-fg'
            : 'bg-muted text-muted-foreground',
      )}
    >
      {state}
    </span>
  )
}
