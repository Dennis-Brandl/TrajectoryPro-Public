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
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { RuntimeHistoryFinalState } from '@/lib/api/types';
import { useLayout } from '~/lib/layout';
import { RESULT_OPTIONS, type HistoryFilters } from './history-filters';

export function HistoryFiltersBar({ value, onChange }: { value: HistoryFilters; onChange: (next: HistoryFilters) => void }) {
  const touch = useLayout() !== 'desktop';
  const [text, setText] = useState(value.search ?? '');
  const field = cn('rounded-md border border-input bg-background px-2 text-sm', touch ? 'h-11' : 'h-8');
  const commitSearch = () => {
    const t = text.trim();
    if (t !== (value.search ?? '')) onChange({ ...value, search: t === '' ? undefined : t });
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        aria-label="Search by workflow" placeholder="Search by workflow" className={cn('min-w-0 flex-1 basis-40', touch ? 'h-11' : 'h-8')}
        value={text} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') commitSearch(); }} onBlur={commitSearch}
      />
      <label className="flex items-center gap-1 text-xs text-muted-foreground">From
        <input type="datetime-local" aria-label="From" className={field} value={value.from}
          onChange={(e) => onChange({ ...value, from: e.target.value })} />
      </label>
      <label className="flex items-center gap-1 text-xs text-muted-foreground">To
        <input type="datetime-local" aria-label="To" className={field} value={value.to}
          onChange={(e) => onChange({ ...value, to: e.target.value })} />
      </label>
      <select
        aria-label="Result" className={field} value={value.state ?? ''}
        onChange={(e) => onChange({ ...value, state: (e.target.value || undefined) as RuntimeHistoryFinalState | undefined })}
      >
        {RESULT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
