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

export type TimeFormatter = { zoneLabel: string; dateTime(iso: string | number): string; time(iso: string | number, dayOf: string | number): string };

/** "GMT-05:00" -> "UTC-05:00"; bare "GMT" -> "UTC+00:00". ASCII hyphen only: the PDF font has no U+2212. */
function offsetLabel(timeZone: string, at: number): string {
  const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(new Date(at)).find(p => p.type === 'timeZoneName')?.value ?? 'GMT';
  const tail = part.replace('GMT', '').replace(/\u2212/g, '-');
  return `UTC${tail === '' ? '+00:00' : tail}`;
}

export function makeTimeFormatter(timeZone: string, reference: string | number): TimeFormatter {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = (t: string | number) => {
    const m: Record<string, string> = {};
    for (const p of dtf.formatToParts(new Date(t))) m[p.type] = p.value;
    return { date: `${m.year}-${m.month}-${m.day}`, clock: `${m.hour}:${m.minute}:${m.second}` };
  };
  const refOffset = offsetLabel(timeZone, new Date(reference).getTime());
  const suffix = (t: string | number) => {
    const o = offsetLabel(timeZone, new Date(t).getTime());
    return o === refOffset ? '' : ` (${o})`;
  };
  return {
    zoneLabel: `${timeZone} (${refOffset})`,
    dateTime: t => { const p = parts(t); return `${p.date} ${p.clock}${suffix(t)}`; },
    time: (t, dayOf) => {
      const p = parts(t);
      return `${p.date === parts(dayOf).date ? p.clock : `${p.date} ${p.clock}`}${suffix(t)}`;
    },
  };
}
