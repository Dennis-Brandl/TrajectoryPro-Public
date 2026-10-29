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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { RuntimeHistoryFinalState, RuntimeHistoryListParams } from '@/lib/api/types';

const STATE_CHIPS: Array<{ value: RuntimeHistoryFinalState | undefined; label: string }> = [
  { value: undefined, label: 'All' },
  { value: 'completed', label: 'Completed' },
  { value: 'stopped', label: 'Stopped' },
  { value: 'aborted', label: 'Aborted' },
  { value: 'errored', label: 'Errored' },
];

/** Phase-7 history filter bar: single-select state chips + a commit-on-Enter/blur search +
 *  a from/to date range, mirroring RuntimeTab's chip idiom (phase 6). Every commit — a chip
 *  click, a search Enter/blur, a date change, or Refresh — resets page to 1 (a filter change
 *  can move the previously-viewed row off the page it was on) and reports the FULL next
 *  filter set through the single `onChange` callback; the parent owns the filter state and
 *  decides how to refetch (see HistoryTab's composite-key vs. explicit-refresh split). */
export function HistoryFilters({ value, onChange }: {
  value: RuntimeHistoryListParams;
  onChange: (next: RuntimeHistoryListParams) => void;
}) {
  // Local echo of the search text: it must NOT commit on every keystroke (only Enter/blur
  // do), so it can't be derived straight from `value` the way the chips/dates are.
  const [searchText, setSearchText] = useState(value.search ?? '');

  const commit = (patch: Partial<RuntimeHistoryListParams>) => {
    onChange({ ...value, ...patch, page: 1 });
  };
  const commitSearch = () => {
    const trimmed = searchText.trim();
    commit({ search: trimmed === '' ? undefined : trimmed });
  };
  // Ticket 2: blur is a very common, non-deliberate event (tab-through, alt-tab away, a click
  // elsewhere to read something) — unlike Enter, it doesn't signal "I'm done editing this."
  // Committing on every blur means an untouched focus-through still resets page to 1 and
  // refires the fetch. So blur only commits when the trimmed text actually differs from the
  // last-committed value; Enter is deliberate keyboard intent and keeps committing
  // unconditionally either way — that asymmetry is intentional, not an oversight.
  const commitSearchOnBlur = () => {
    if (searchText.trim() !== (value.search ?? '')) commitSearch();
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex gap-1">
        {STATE_CHIPS.map((chip) => (
          <Button key={chip.label} type="button" size="sm"
            variant={value.state === chip.value ? 'secondary' : 'ghost'}
            onClick={() => commit({ state: chip.value })}>
            {chip.label}
          </Button>
        ))}
      </div>
      <Input
        aria-label="Search"
        placeholder="Search workflow name…"
        className="h-8 w-48"
        value={searchText}
        onChange={(e) => setSearchText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') commitSearch(); }}
        onBlur={commitSearchOnBlur}
      />
      <Input
        type="datetime-local" aria-label="From" className="h-8 w-auto"
        value={value.from ?? ''}
        onChange={(e) => commit({ from: e.target.value === '' ? undefined : e.target.value })}
      />
      <Input
        type="datetime-local" aria-label="To" className="h-8 w-auto"
        value={value.to ?? ''}
        onChange={(e) => commit({ to: e.target.value === '' ? undefined : e.target.value })}
      />
      <Button type="button" variant="ghost" size="sm" onClick={() => commit({})}>Refresh</Button>
    </div>
  );
}
