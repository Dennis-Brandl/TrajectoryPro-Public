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
import type { RuntimeScheduleEvent } from '@/lib/api/types';
import { formatInZone } from './schedule-format';

const num = (d: Record<string, unknown>, k: string): number => (typeof d[k] === 'number' ? (d[k] as number) : 0);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A log row in plain words, e.g. "Paused by jsmith" or "Resumed by jsmith: started 2 of 97 missed, skipped 95". */
export function eventText(e: RuntimeScheduleEvent, timeZone: string): string {
  const d = (e.detail && typeof e.detail === 'object' ? e.detail : {}) as Record<string, unknown>;
  const by = e.actorKind === 'system' ? '' : ` by ${e.actorName ?? (e.actorKind === 'api_client' ? 'an API client' : 'a user')}`;
  switch (e.action) {
    case 'enabled': return `Enabled${by}`;
    case 'run_once': return `Run Once requested${by}`;
    case 'paused': return `Paused${by}`;
    case 'resumed': {
      const missed = num(d, 'missedCount');
      const parts: string[] = [];
      if (missed > 0) parts.push(`started ${num(d, 'startedSlots')} of ${missed} missed, skipped ${num(d, 'skippedSlots')}`);
      const chains = num(d, 'startedChains') + num(d, 'skippedChains');
      if (chains > 0) parts.push(`${plural(num(d, 'startedChains'), 'chain', 'chains')} started, ${num(d, 'skippedChains')} skipped`);
      return `Resumed${by}${parts.length ? `: ${parts.join('; ')}` : ''}`;
    }
    case 'removed': return `Removed from the list${by}`;
    case 'cancelled': return `Cancelled${by}${typeof d.reason === 'string' && d.reason ? `: ${d.reason}` : ''}`;
    case 'item_disabled': return `Disabled ${String(d.name ?? 'an item')}${by}`;
    case 'item_enabled': return `Re-enabled ${String(d.name ?? 'an item')}${by}`;
    case 'items_acknowledged': return `Dismissed ${plural(num(d, 'count'), 'item', 'items')}${by}`;
    case 'slot_fired': {
      const failed = num(d, 'failed');
      const when = typeof d.scheduledAt === 'string' ? ` (scheduled ${formatInZone(d.scheduledAt, timeZone)})` : '';
      return `Occurrence ${num(d, 'number')} started${when}: ${num(d, 'started')} started${failed ? `, ${failed} failed` : ''}`;
    }
    case 'slots_missed': {
      const w = typeof d.from === 'string' && typeof d.to === 'string' ? ` between ${formatInZone(d.from, timeZone)} and ${formatInZone(d.to, timeZone)}` : '';
      return `Scheduled starts were missed${w}`;
    }
    case 'catchup_finished': return 'Catch-up finished';
    case 'finished': return 'Finished';
    case 'slot_already_recorded': return 'A start was already recorded, so it was not repeated';
    case 'next_fire_realigned': return 'Next start moved to match the schedule';
    default: { const t = e.action.replace(/_/g, ' '); return t.charAt(0).toUpperCase() + t.slice(1) + by; }
  }
}
