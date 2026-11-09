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
import { toast } from 'sonner';
import { apiErrorMessage } from '@/lib/api/client';
import type { RuntimeScheduleStatus, RuntimeScheduleView } from '@/lib/api/types';

/** Every Schedules component reports failures through this, so XO can pass its own handler. */
export type OnError = (err: unknown, fallback: string) => void;
export const defaultOnError: OnError = (err, fallback) => { toast.error(apiErrorMessage(err, fallback)); };

function parts(iso: string, timeZone: string, opts: Intl.DateTimeFormatOptions): Record<string, string> {
  let fmt: Intl.DateTimeFormat;
  try { fmt = new Intl.DateTimeFormat('en-US', { ...opts, timeZone, hourCycle: 'h23' }); }
  catch { fmt = new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'UTC', hourCycle: 'h23' }); }
  return Object.fromEntries(fmt.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
}

/** "Mon Nov 9, 09:00" in the Runtime Schedule's own (frozen) zone. */
export function formatInZone(iso: string, timeZone: string): string {
  const p = parts(iso, timeZone, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return `${p.weekday} ${p.month} ${p.day}, ${p.hour}:${p.minute}`;
}

/** "Fri 10:00", as the Resume dialog words the missed window. */
export function formatSlot(iso: string, timeZone: string): string {
  const p = parts(iso, timeZone, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  return `${p.weekday} ${p.hour}:${p.minute}`;
}

/** "Monday 09:14", the long weekday the Resume dialog's first line uses. */
export function formatLongSlot(iso: string, timeZone: string): string {
  const p = parts(iso, timeZone, { weekday: 'long', hour: '2-digit', minute: '2-digit' });
  return `${p.weekday} ${p.hour}:${p.minute}`;
}

/** "4 days 2 hours", "3 hours", "12 minutes": how long ago, in words. */
export function agoText(fromIso: string, now: number = Date.now()): string {
  const mins = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 60_000));
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const unit = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  if (days > 0) return hours > 0 ? `${unit(days, 'day')} ${unit(hours, 'hour')}` : unit(days, 'day');
  if (hours > 0) return unit(hours, 'hour');
  return unit(mins, 'minute');
}

export const STATUS_LABEL: Record<RuntimeScheduleStatus, string> = {
  active: 'Active', paused: 'Paused', cancelled: 'Cancelled', finished: 'Finished',
};

export const needsAttention = (v: Pick<RuntimeScheduleView, 'needsAttention'>) =>
  v.needsAttention.failed + v.needsAttention.lost > 0 || v.needsAttention.missedWindow;

/** What needs a person, in plain words, for the pill's tooltip and the detail header. */
export function needsAttentionText(v: Pick<RuntimeScheduleView, 'needsAttention'>): string {
  const a = v.needsAttention;
  const out: string[] = [];
  if (a.failed > 0) out.push(`${a.failed} failed to start`);
  if (a.lost > 0) out.push(`${a.lost} lost`);
  if (a.missedWindow) out.push('missed starts need a decision');
  return out.join(', ');
}
