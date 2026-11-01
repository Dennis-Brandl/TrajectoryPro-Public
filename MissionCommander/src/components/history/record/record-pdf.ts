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
import { autoTable, type CellHookData, type RowInput, type Styles } from 'jspdf-autotable';
import type { RecordLogRow, RecordModel } from './record-model';

export type RecordPdfResult = { doc: jsPDF; placements: Array<{ index: number; firstPage: number; lastPage: number }>; pageCount: number };

// Portrait US Letter only, always with an explicit [w, h] array (Designer's pdf-export-spec:
// string formats and landscape pages produce blank pages in jsPDF).
const PAGE: [number, number] = [612, 792];
const MARGIN = 36;
const CONTENT_W = PAGE[0] - 2 * MARGIN;
const BOTTOM = PAGE[1] - MARGIN;
const LINE_FACTOR = 1.15; // jsPDF's default line-height factor, which autotable also uses
const PAD = 2;
const BODY = 9;
const PARAM = 8.5;
const COLS = [120, 0, 44, 64, 96];
COLS[1] = CONTENT_W - COLS.reduce((a, b) => a + b, 0); // Step takes what the fixed columns leave
const HEAD = ['Time', 'Step', 'Run', 'Result', 'Performed by'];
const HEAD_H = BODY * LINE_FACTOR + 2 * PAD;
const INK = '#111111';
const GREY = '#666666';
const RED = '#AA0000';
// Floating-point slack so a group that measures as exactly fitting is not split by autotable.
const EPS = 0.01;

// Code points outside Latin-1 that WinAnsi (cp1252) still has, 0x80-0x9F.
const CP1252_EXTRA = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d,
  0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

/** Helvetica in jsPDF only draws WinAnsi; anything else becomes '?' (one per code point) rather than vanishing. */
export function pdfSafe(text: string): string {
  let out = '';
  for (const ch of text.replace(/\r\n?/g, '\n').replace(/\t/g, ' ')) {
    const c = ch.codePointAt(0)!;
    out += c === 0x0a || (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || CP1252_EXTRA.has(c) ? ch : '?';
  }
  return out;
}

/** One table cell, described once so measuring and drawing cannot disagree. */
type CellSpec = { text: string; width: number; padLeft: number; fontSize: number; color: string; colSpan: number };

const cell = (text: string, col: number, o: Partial<CellSpec> = {}): CellSpec => {
  const colSpan = o.colSpan ?? 1;
  return { text: pdfSafe(text), width: COLS.slice(col, col + colSpan).reduce((a, b) => a + b, 0), padLeft: PAD, fontSize: BODY, color: INK, colSpan, ...o };
};

const fullWidth = (text: string, depth: number, color: string): CellSpec[] =>
  [cell(text, 0, { colSpan: 5, fontSize: PARAM, color, padLeft: PAD + 10 + 10 * depth })];

/** A step run plus its parameter, signature and error lines, or one event row. */
function groupRows(row: RecordLogRow): CellSpec[][] {
  const step = cell(row.step, 1, { padLeft: PAD + 10 * row.depth });
  if (row.kind === 'event') {
    return [[cell(row.time, 0), step, cell(row.text, 2, { colSpan: 2, color: row.error ? RED : INK }), cell(row.performedBy, 4)]];
  }
  return [
    [cell(row.time, 0), step, cell(row.run, 2), cell(row.result, 3), cell(row.performedBy, 4)],
    ...(row.params !== null ? [fullWidth(row.params, row.depth, '#333333')] : []),
    ...row.signatures.map(s => fullWidth(s, row.depth, '#006644')),
    ...(row.error !== null ? [fullWidth(row.error, row.depth, RED)] : []),
  ];
}

export function renderRecordPdf(model: RecordModel): RecordPdfResult {
  const doc = new jsPDF({ unit: 'pt', format: PAGE, orientation: 'portrait' });
  doc.setLineHeightFactor(LINE_FACTOR);
  const written = new Set<number>();
  const currentPage = () => doc.getCurrentPageInfo().pageNumber;
  let y = MARGIN;

  const font = (size: number, style: 'normal' | 'bold' = 'normal', color = INK) => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    doc.setTextColor(color);
  };
  const wrap = (text: string, width: number): string[] => doc.splitTextToSize(pdfSafe(text), width) as string[];
  const draw = (text: string, x: number, at: number) => {
    doc.text(text, x, at, { baseline: 'top' });
    written.add(currentPage());
  };
  // The only place a page is added outside autotable: right before content that would not fit.
  const ensure = (h: number) => {
    if (y + h > BOTTOM && y > MARGIN) {
      doc.addPage(PAGE, 'portrait');
      y = MARGIN;
    }
  };

  // Mirrors autotable's own sizing: splitTextToSize at (cell width - padding + 1) in the cell's font.
  const rowHeight = (cells: CellSpec[]) => Math.max(...cells.map(c => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(c.fontSize);
    const lines = (doc.splitTextToSize(c.text, c.width - c.padLeft - PAD + 1, { fontSize: c.fontSize }) as string[]).length;
    return lines * c.fontSize * LINE_FACTOR + 2 * PAD;
  }));

  // Title and header grid.
  font(13, 'bold');
  for (const line of wrap(model.title, CONTENT_W)) { draw(line, MARGIN, y); y += 13 * LINE_FACTOR; }
  y += 4;
  const LABEL_W = 62;
  const HALF = CONTENT_W / 2;
  for (let i = 0; i < model.header.length; i += 2) {
    const pairs = model.header.slice(i, i + 2);
    font(BODY);
    const values = pairs.map(([, v]) => wrap(v, HALF - LABEL_W - 8));
    const h = Math.max(...values.map(v => v.length)) * BODY * LINE_FACTOR;
    ensure(h);
    pairs.forEach(([label], k) => {
      const x = MARGIN + k * HALF;
      font(BODY, 'bold', '#555555');
      draw(pdfSafe(label), x, y);
      font(BODY);
      values[k].forEach((line, n) => draw(line, x + LABEL_W, y + n * BODY * LINE_FACTOR));
    });
    y += h + 1;
  }
  font(BODY, 'normal', GREY);
  for (const line of wrap(model.zoneNote, CONTENT_W)) { ensure(BODY * LINE_FACTOR); draw(line, MARGIN, y); y += BODY * LINE_FACTOR; }
  y += 6;

  const heading = (text: string, keepWith: number) => {
    ensure(10 * LINE_FACTOR + 4 + keepWith);
    font(10, 'bold');
    draw(pdfSafe(text), MARGIN, y);
    y += 10 * LINE_FACTOR + 1;
    doc.setLineWidth(0.5);
    doc.setDrawColor('#999999');
    doc.line(MARGIN, y, MARGIN + CONTENT_W, y);
    y += 3;
  };
  const packed = (title: string, text: string) => {
    heading(title, BODY * LINE_FACTOR);
    font(BODY); // wrap() measures in the current font
    for (const line of wrap(text, CONTENT_W)) { ensure(BODY * LINE_FACTOR); font(BODY); draw(line, MARGIN, y); y += BODY * LINE_FACTOR; }
    y += 6;
  };

  packed('Starting parameters', model.startingParams);

  // Step log: one autotable call per group, at a tracked startY.
  const placements: RecordPdfResult['placements'] = [];
  const groups = model.log.map(groupRows);
  const heights = groups.map(g => g.reduce((a, r) => a + rowHeight(r), 0));
  const fitsEmptyPage = (h: number) => h + EPS <= BOTTOM - MARGIN - HEAD_H;
  if (groups.length === 0) {
    packed('Step log', 'No step runs recorded.');
  } else {
    heading('Step log', HEAD_H + (fitsEmptyPage(heights[0]) ? heights[0] : rowHeight(groups[0][0])));
    groups.forEach((rows, index) => {
      const atTop = index === 0 || y === MARGIN;
      let showHead = atTop;
      let startY = y;
      let hideFirstHead = false;
      if (fitsEmptyPage(heights[index])) {
        if (y + (showHead ? HEAD_H : 0) + heights[index] + EPS > BOTTOM) {
          doc.addPage(PAGE, 'portrait');
          y = startY = MARGIN;
          showHead = true;
        }
      } else if (!atTop) {
        // Oversized and mid-page: the header belongs on its continuation pages only, so its
        // first-page copy sits invisibly above startY instead of taking space.
        showHead = true;
        hideFirstHead = true;
        startY = y - HEAD_H;
      }
      const oversized = !fitsEmptyPage(heights[index]);
      let first = Number.POSITIVE_INFINITY;
      let last = 0;
      const body: RowInput[] = rows.map((r, n) => r.map(c => ({
        content: c.text,
        colSpan: c.colSpan,
        styles: {
          fontSize: c.fontSize, textColor: c.color,
          cellPadding: { top: PAD, right: PAD, bottom: PAD, left: c.padLeft },
          lineWidth: n === rows.length - 1 ? { top: 0, right: 0, bottom: 0.5, left: 0 } : 0,
        } satisfies Partial<Styles>,
      })));
      autoTable(doc, {
        startY,
        margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
        tableWidth: CONTENT_W,
        theme: 'plain',
        head: showHead ? [HEAD] : undefined,
        showHead: !showHead ? 'never' : oversized ? 'everyPage' : 'firstPage',
        body,
        rowPageBreak: oversized ? 'auto' : 'avoid',
        styles: { font: 'helvetica', fontSize: BODY, cellPadding: PAD, textColor: INK, overflow: 'linebreak', valign: 'top', lineColor: '#e3e3e3', lineWidth: 0 },
        headStyles: { fontStyle: 'bold', fillColor: '#eeeeee', textColor: INK },
        columnStyles: Object.fromEntries(COLS.map((w, i) => [i, { cellWidth: w }])),
        willDrawCell: (d: CellHookData) => (hideFirstHead && d.section === 'head' && d.pageNumber === 1 ? false : undefined),
        didDrawCell: (d: CellHookData) => {
          const p = currentPage();
          written.add(p);
          if (d.section === 'body') { first = Math.min(first, p); last = Math.max(last, p); }
        },
      });
      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
      placements.push({ index, firstPage: first, lastPage: last });
    });
    y += 8;
  }

  packed('Outputs', model.finalValues);

  // Safety net: drop any page nothing was drawn on (e.g. one autotable added), then renumber.
  const total = doc.getNumberOfPages();
  const removed: number[] = [];
  for (let p = total; p >= 1; p--) {
    if (!written.has(p) && doc.getNumberOfPages() > 1) { doc.deletePage(p); removed.push(p); }
  }
  const renumber = (p: number) => p - removed.filter(r => r < p).length;
  for (const pl of placements) { pl.firstPage = renumber(pl.firstPage); pl.lastPage = renumber(pl.lastPage); }

  // Footer pass last, so "of Y" is the final count.
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    font(8, 'normal', '#808080');
    const footY = PAGE[1] - MARGIN + 12;
    doc.text(pdfSafe(model.footerLeft), MARGIN, footY, { baseline: 'top' });
    doc.text(`Page ${p} of ${pageCount}`, MARGIN + CONTENT_W, footY, { baseline: 'top', align: 'right' });
  }
  return { doc, placements, pageCount };
}
