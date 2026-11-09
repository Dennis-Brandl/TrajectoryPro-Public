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
import { Button } from '@/components/ui/button';
import type { RuntimeScheduleItemView } from '@/lib/api/types';

/** The frozen start list and its chains as an indented list. Disable stays in force across
 *  occurrences until re-enabled (spec §7.2). */
export function ScheduleItemTree({ items, canControl, busyId, onToggle }: {
  items: RuntimeScheduleItemView[];
  canControl: boolean;
  busyId?: string | null;
  onToggle: (item: RuntimeScheduleItemView, disabled: boolean) => void;
}) {
  const flat: Array<{ it: RuntimeScheduleItemView; depth: number }> = [];
  const walk = (list: RuntimeScheduleItemView[], depth: number) => {
    for (const it of list) { flat.push({ it, depth }); walk(it.children, depth + 1); }
  };
  walk(items, 0);
  return (
    <ul className="divide-y rounded-md border px-3">
      {flat.map(({ it, depth }) => (
      <li key={it.id} data-depth={depth} style={{ paddingLeft: `${depth * 1.5}rem` }}
        className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
        <span className={it.disabled ? 'font-medium text-muted-foreground line-through' : 'font-medium'}>{it.masterName}</span>
        <span className="text-muted-foreground">v{it.masterVersion}</span>
        <StateTag state={it.masterState} />
        {it.triggerOn && <span className="text-xs text-muted-foreground">after {it.triggerOn.join(' or ')}</span>}
        {it.newerVersionAvailable && (
          <span className="rounded bg-status-info-bg px-1.5 py-0.5 text-[11px] text-status-info-fg">newer version available</span>
        )}
        {it.disabled && <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">Disabled</span>}
        {canControl && (
          <Button type="button" variant="outline" size="sm" className="ml-auto" disabled={busyId === it.id}
            aria-label={`${it.disabled ? 'Re-enable' : 'Disable'} ${it.masterName}`}
            onClick={() => onToggle(it, !it.disabled)}>
            {it.disabled ? 'Re-enable' : 'Disable'}
          </Button>
        )}
      </li>
      ))}
    </ul>
  );
}
