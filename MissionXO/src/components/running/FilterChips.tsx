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
import type { RuntimeListFilter, RuntimeStatusCounts } from '@/lib/api/types';
import { cn } from '@/lib/utils';

const CHIPS: { id: RuntimeListFilter; label: string; count?: keyof RuntimeStatusCounts }[] = [
  { id: 'active', label: 'Active', count: 'active' },
  { id: 'pending', label: 'Waiting', count: 'pending' },
  { id: 'finished', label: 'Finished', count: 'finished' },
  { id: 'all', label: 'All' },
];

export function FilterChips({ value, counts, onChange, compact }: {
  value: RuntimeListFilter;
  counts?: RuntimeStatusCounts;
  onChange: (f: RuntimeListFilter) => void;
  compact?: boolean;
}) {
  return (
    <div role="group" aria-label="Filter runtimes" className="flex flex-wrap gap-2">
      {CHIPS.map(({ id, label, count }) => {
        const n = count && counts ? counts[count] : 0;
        const active = id === value;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(id)}
            className={cn(
              'inline-flex items-center rounded-full border px-3.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              compact ? 'h-[30px]' : 'h-11',
              active ? 'border-selection bg-selection/10 font-semibold text-foreground' : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            {n > 0 ? `${label} · ${n}` : label}
          </button>
        );
      })}
    </div>
  );
}
