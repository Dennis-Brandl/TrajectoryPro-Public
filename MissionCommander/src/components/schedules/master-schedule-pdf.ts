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

import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { pdfSafe } from '@/components/history/record/record-pdf';
import type { MasterScheduleChange, MasterScheduleRecord, Recurrence, ScheduleItemInput } from '@/lib/api/types';

// The Master Schedule as a controlled document (2026-11-09 request): its definition at this
// version, then every saved version with when, who and why. Built in the browser, like the
// runtime record PDF, and loaded only when someone exports.

type ValueSource = NonNullable<ScheduleItemInput['params']>[string];

export type MasterScheduleModel = {
  title: string;
  header: Array<[string, string]>;
  zoneNote: string;
  workflows: Array<{ number: string; name: string; version: string; starts: string; values: string }>;
  changes: Array<{ version: string; at: string; who: string; reason: string }>;
  footerLeft: string;
};

const ENDING_VERB: Record<string, string> = { completed: 'completes', stopped: 'is stopped', aborted: 'is aborted', errored: 'errors' };
const OCCURRENCE_TEXT: Record<string, string> = {
  'occurrence.date': 'the occurrence date', 'occurrence.datetime': 'the occurrence date and time', 'occurrence.number': 'the occurrence number',
};

/** "2026-11-09 14:46" in `zone`. */
export function dateTimeIn(iso: string, zone: string): string {
  let fmt: Intl.DateTimeFormat;
  const opts: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  try { fmt = new Intl.DateTimeFormat('en-US', { ...opts, timeZone: zone }); } catch { fmt = new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'UTC' }); }
  const p = Object.fromEntries(fmt.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

export function valueSourceText(s: ValueSource): string {
  const fallback = 'fallback' in s && s.fallback !== undefined ? `, else "${s.fallback}"` : '';
  if ('value' in s) return s.value === '' ? '(blank)' : `"${s.value}"`;
  if ('template' in s) return `template "${s.template}"${fallback}`;
  if (s.from === 'trigger.input') return `starting value "${s.name}" of the run that triggered it${fallback}`;
  if (s.from === 'trigger.output') return `output "${s.name}" of the run that triggered it${fallback}`;
  return `${OCCURRENCE_TEXT[s.from] ?? s.from}${fallback}`;
}

/** When the pattern starts and stops, which the one-line description leaves out. */
export function rangeText(r: Recurrence): string {
  if (r.type === 'manual' || r.type === 'once' || r.type === 'runOnce') return '';
  const range = (r as { range?: { startDate?: string; endAfter?: number; endBy?: string } }).range;
  const start = r.type === 'interval' ? `from ${r.startAt.replace('T', ' ')}` : range?.startDate ? `from ${range.startDate}` : '';
  const end = range?.endAfter !== undefined ? `, ending after ${range.endAfter} occurrence${range.endAfter === 1 ? '' : 's'}`
    : range?.endBy !== undefined ? `, ending on ${range.endBy}` : ', with no end';
  return `${start}${end}`.replace(/^, /, '');
}

function whoText(c: MasterScheduleChange): string {
  if (c.actorKind === 'system') return 'System';
  const name = c.actorName ?? (c.actorKind === 'api_client' ? 'an API client' : 'a user');
  return c.actorKind === 'api_client' ? `${name} (API client)` : name;
}

function workflowRows(items: ScheduleItemInput[], prefix = '', parent: string | null = null): MasterScheduleModel['workflows'] {
  return items.flatMap((it, i) => {
    const number = `${prefix}${i + 1}`;
    const endings = (it.triggerOn ?? []).map((e) => ENDING_VERB[e] ?? e);
    const starts = parent === null ? 'At each scheduled time, in list order' : `When ${parent} ${endings.join(' or ')}`;
    const values = Object.entries(it.params ?? {}).map(([k, v]) => `${k} = ${valueSourceText(v)}`).join('\n');
    return [
      { number, name: it.workflow.name, version: it.workflow.version ?? 'Current at Enable', starts, values: values || '(defaults)' },
      ...workflowRows(it.chain ?? [], `${number}.`, number),
    ];
  });
}

export function buildMasterScheduleModel(record: MasterScheduleRecord, opts: { now: Date; loginName: string }): MasterScheduleModel {
  const { master, timeZone } = record;
  const range = rangeText(master.recurrence);
  const source = master.source === 'api'
    ? `REST interface${master.managedBy ? `, ${master.managedBy}` : ''}${master.externalKey ? `, key ${master.externalKey}` : ''}`
    : 'Mission Commander';
  return {
    title: `Master Schedule: ${master.name}`,
    header: [
      ['Name', master.name],
      ['Description', master.description?.trim() || '—'],
      ['Work center', record.workCenterName || '—'],
      ['Version', String(master.revision)],
      ['Last saved', dateTimeIn(master.updatedAt, timeZone)],
      ['Source', source],
      ['Time zone', timeZone],
      ['Recurrence', range ? `${master.recurrenceText}, ${range}` : master.recurrenceText],
    ],
    zoneNote: `Times are in ${timeZone}.`,
    workflows: workflowRows(master.items),
    changes: record.changes.map((c) => ({
      version: String(c.version), at: dateTimeIn(c.at, timeZone), who: whoText(c), reason: c.reason ?? '(no reason recorded)',
    })),
    footerLeft: `${master.name} version ${master.revision} · Exported ${dateTimeIn(opts.now.toISOString(), timeZone)} by ${opts.loginName}`,
  };
}

const MARGIN = 36;
const INK = '#111111';
const GREY = '#666666';

export function renderMasterSchedulePdf(model: MasterScheduleModel): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
  const width = doc.internal.pageSize.getWidth() - 2 * MARGIN;
  let y = MARGIN;
  const text = (t: string, size: number, style: 'normal' | 'bold' = 'normal', color = INK) => {
    doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(color);
    const lines = doc.splitTextToSize(pdfSafe(t), width) as string[];
    doc.text(lines, MARGIN, y, { baseline: 'top' });
    y += lines.length * size * 1.15 + 4;
  };
  const table = (head: string[], body: string[][], widths: number[]) => {
    autoTable(doc, {
      startY: y, head: [head], body: body.map((r) => r.map(pdfSafe)), margin: { left: MARGIN, right: MARGIN, bottom: MARGIN + 18 },
      styles: { font: 'helvetica', fontSize: 9, cellPadding: 3, textColor: INK, overflow: 'linebreak', valign: 'top' },
      headStyles: { fillColor: [235, 235, 235], textColor: INK, fontStyle: 'bold' },
      columnStyles: Object.fromEntries(widths.map((w, i) => [i, w > 0 ? { cellWidth: w } : {}])),
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 14;
  };

  text(model.title, 16, 'bold');
  table(['', ''], model.header.map(([k, v]) => [k, v]), [90, 0]);
  text(model.zoneNote, 8.5, 'normal', GREY);

  text('Workflows', 12, 'bold');
  table(['No.', 'Workflow', 'Version', 'Starts', 'Starting values'],
    model.workflows.map((w) => [w.number, w.name, w.version, w.starts, w.values]), [34, 110, 64, 110, 0]);

  text('Change history', 12, 'bold');
  table(['Version', 'Date and time', 'Changed by', 'Reason'],
    model.changes.map((c) => [c.version, c.at, c.who, c.reason]), [48, 90, 110, 0]);

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(GREY);
    const footY = doc.internal.pageSize.getHeight() - MARGIN;
    doc.text(pdfSafe(model.footerLeft), MARGIN, footY, { baseline: 'top' });
    doc.text(`Page ${p} of ${pages}`, MARGIN + width, footY, { baseline: 'top', align: 'right' });
  }
  return doc;
}

export function masterSchedulePdfName(record: Pick<MasterScheduleRecord, 'master'>): string {
  const clean = (s: string) => s.replace(/[\\/:*?"<>|]/g, '_').trim();
  return `${clean(record.master.name)} v${record.master.revision}.pdf`;
}
