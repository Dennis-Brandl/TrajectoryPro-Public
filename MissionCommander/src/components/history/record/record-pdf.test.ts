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

import { describe, it, expect } from 'vitest';
import type { jsPDF } from 'jspdf';
import type { RuntimeHistoryDetail, StepRunView } from '../../../lib/api/types';
import { buildRecordModel, type RecordLogRow, type RecordModel } from './record-model';
import { pdfSafe, renderRecordPdf } from './record-pdf';

// The design mockup's pizza run (same shape as record-model.test.ts's loopDetail).
function run(p: Partial<StepRunView> & { stepOid: string; stepName: string; startedAt: string | null; finishedAt: string }): StepRunView {
  return {
    id: `r-${p.stepOid}-${p.finishedAt}`, stepInstanceId: null, stepType: 'UI', runNumber: 1, result: 'completed',
    error: null, inputParameters: null, outputParameters: null, performedByLoginName: 'jdoe', performedByKind: 'user', nodePath: [], ...p,
  };
}

function mockupDetail(): RuntimeHistoryDetail {
  return {
    id: 'h1', workflowInstanceId: null, workCenterId: 'wc', workCenterName: 'Line 1', runtimeNumber: 4, runtimeLabel: 'MIX-20261027-0004',
    masterName: 'Pizza Order', masterOid: 'm', masterVersion: '1.2.0', masterState: 'Effective', finalState: 'completed',
    startedAt: '2026-10-27T14:14:03Z', finishedAt: '2026-10-27T14:21:47Z', createdAt: '2026-10-27T14:14:03Z',
    startingParams: { Size: 'large', Crust: 'chicago' }, trace: [], properties: { Cost: '9.66' }, stepParams: null,
    stepNames: {}, startedByLoginName: 'jdoe', startedByUserId: 'u1', userNames: {},
    createdByLabel: null, createdByInstanceId: null, outputs: [{ name: 'Toppings', value: '["cheese","ham","olives"]' }],
    stepRuns: [
      run({ stepOid: 'eo', stepName: 'Enter Order', startedAt: '2026-10-27T14:14:05Z', finishedAt: '2026-10-27T14:15:10Z', inputParameters: { Size: 'large' }, outputParameters: { Customer: 'Smith' } }),
      run({ stepOid: 'at', stepName: 'Add Topping', startedAt: '2026-10-27T14:15:12Z', finishedAt: '2026-10-27T14:16:01Z', inputParameters: { Toppings: '[]' }, outputParameters: { Toppings: '["cheese"]' } }),
      run({ stepOid: 'at', stepName: 'Add Topping', startedAt: '2026-10-27T14:16:03Z', finishedAt: '2026-10-27T14:16:40Z', inputParameters: { Toppings: '["cheese"]' }, outputParameters: { Toppings: '["cheese","ham"]' } }),
      run({ stepOid: 'at', stepName: 'Add Topping', startedAt: '2026-10-27T14:16:42Z', finishedAt: '2026-10-27T14:17:20Z', performedByLoginName: 'asmith', inputParameters: { Toppings: '["cheese","ham"]' }, outputParameters: { Toppings: '["cheese","ham","olives"]' } }),
      run({ stepOid: 'pr', stepName: 'Price', startedAt: '2026-10-27T14:17:21Z', finishedAt: '2026-10-27T14:17:21Z', performedByKind: 'script', performedByLoginName: null, outputParameters: { Cost: '9.66' } }),
      run({ stepOid: 'qa', stepName: 'QA Approve', startedAt: '2026-10-27T14:17:22Z', finishedAt: '2026-10-27T14:21:45Z' }),
    ],
    signatures: [{
      id: 's1', stepOid: 'qa', stepName: 'QA Approve', signerLoginName: 'qlee', signerDisplayName: 'Q. Lee', roleName: 'Quality',
      meaning: 'Approved', decision: null, outcome: 'signed', failureCode: null, signedAt: '2026-10-27T14:21:45Z',
    }],
  };
}

const mockupModel = () => buildRecordModel(mockupDetail(), { timeZone: 'America/Chicago', now: new Date('2026-10-27T19:02:00Z'), loginName: 'admin' });

function model(log: RecordLogRow[], over: Partial<RecordModel> = {}): RecordModel {
  return {
    title: 'RW-1 · Synthetic v1.0.0',
    header: [['Work center', 'Line 1'], ['Final state', 'completed'], ['Started', '2026-10-27 09:00:00 by jdoe'],
      ['Finished', '2026-10-27 12:00:00'], ['Duration', '3h 00m'], ['Created by', '—']],
    zoneNote: 'Times are America/Chicago (UTC-05:00)',
    startingParams: 'a = 1 · b = 2', log, finalValues: 'x = 9', footerLeft: 'RW-1 · Generated 2026-10-27 12:00:00 by admin', ...over,
  };
}

/** A param string that wraps to roughly `lines` lines across the full width at 8.5 pt. */
const params = (lines: number) => 'In: ' + Array.from({ length: lines * 7 }, (_, j) => `param${j} = value${j}`).join(' · ');

function syntheticRows(n: number): RecordLogRow[] {
  return Array.from({ length: n }, (_, i): RecordLogRow => i % 37 === 5
    ? { kind: 'event', time: '10:00:00', step: '(runtime)', depth: 0, text: 'Paused', performedBy: 'asmith' }
    : {
      kind: 'run', time: '10:00:00 – 10:00:05', step: `Step number ${i}`, depth: i % 3, run: i % 4 === 0 ? '2 of 3' : '1',
      result: 'completed', performedBy: 'jdoe', params: params(1 + (i % 6)),
      signatures: i % 7 === 0 ? ['Signed by Q. Lee (Quality) · "Approved" · approve · 10:00:05'] : [],
      error: i % 11 === 0 ? 'Something went wrong in this step' : null,
    });
}

const pageContent = (doc: jsPDF, i: number) => ((doc.internal as unknown as { pages: string[][] }).pages[i] ?? []).join('\n');
const textOps = (s: string) => (s.match(/\) Tj/g) ?? []).length;

function expectNoBlankPages(doc: jsPDF, pageCount: number) {
  for (let i = 1; i <= pageCount; i++) {
    // The footer alone is two text ops; every page must carry more than that.
    expect(textOps(pageContent(doc, i)), `page ${i}`).toBeGreaterThan(2);
  }
}

describe('renderRecordPdf', () => {
  it('small run fits on one page', () => {
    const { doc, pageCount, placements } = renderRecordPdf(mockupModel());
    expect(pageCount).toBe(1);
    expect(doc.getNumberOfPages()).toBe(1);
    expect(placements).toHaveLength(6);
    expect(placements.every(p => p.firstPage === 1 && p.lastPage === 1)).toBe(true);
  });

  it('groups never split when they fit', () => {
    const { doc, pageCount, placements } = renderRecordPdf(model(syntheticRows(300)));
    expect(pageCount).toBe(doc.getNumberOfPages());
    expect(pageCount).toBeGreaterThan(10);
    expect(placements).toHaveLength(300);
    expect(placements.map(p => p.index)).toEqual(Array.from({ length: 300 }, (_, i) => i));
    for (const p of placements) expect(p.firstPage, `group ${p.index}`).toBe(p.lastPage);
    expectNoBlankPages(doc, pageCount);
    // The column header repeats once at the top of every page holding log rows.
    const logPages = new Set(placements.map(p => p.firstPage));
    for (const i of logPages) expect(pageContent(doc, i).match(/\(Performed by\) Tj/g), `page ${i}`).toHaveLength(1);
  });

  it('oversized group splits without a blank page', () => {
    const huge = 'In: ' + Array.from({ length: 400 }, (_, j) => `parameterName${j} = someLongerValue${j}`).join(' · ');
    const rows = syntheticRows(12);
    rows.splice(6, 0, { kind: 'run', time: '11:00:00 – 11:00:01', step: 'Huge', depth: 0, run: '1', result: 'completed', performedBy: 'jdoe', params: huge, signatures: [], error: null });
    const { doc, pageCount, placements } = renderRecordPdf(model(rows));
    const p = placements.find(x => x.index === 6)!;
    expect(p.lastPage).toBeGreaterThan(p.firstPage);
    expect(pageCount).toBe(doc.getNumberOfPages());
    expectNoBlankPages(doc, pageCount);
    // Continuation pages repeat the header; no page ever has two.
    for (let i = 1; i <= pageCount; i++) expect((pageContent(doc, i).match(/\(Performed by\) Tj/g) ?? []).length).toBeLessThanOrEqual(1);
    for (let i = p.firstPage + 1; i <= p.lastPage; i++) expect(pageContent(doc, i)).toContain('(Performed by) Tj');
  });

  it('footer on every page', () => {
    const { doc, pageCount } = renderRecordPdf(model(syntheticRows(120)));
    expect(pageCount).toBeGreaterThan(1);
    const out = doc.output();
    for (let i = 1; i <= pageCount; i++) expect(out).toContain(`Page ${i} of ${pageCount}`);
    expect(out).not.toContain(`Page ${pageCount + 1} of`);
  });

  it('pages are portrait letter', () => {
    const { doc, pageCount } = renderRecordPdf(model(syntheticRows(120)));
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      expect(doc.internal.pageSize.getWidth()).toBe(612);
      expect(doc.internal.pageSize.getHeight()).toBe(792);
    }
  });

  it('non-WinAnsi characters are replaced, not dropped', () => {
    expect(pdfSafe('a😀b−c中')).toBe('a?b?c?');
    expect(pdfSafe('a · b – c › “d” é € ™')).toBe('a · b – c › “d” é € ™');
    const weird = 'x😀−中';
    const { doc } = renderRecordPdf(model(
      [{ kind: 'run', time: weird, step: weird, depth: 0, run: weird, result: weird, performedBy: weird, params: weird, signatures: [weird], error: weird }],
      { title: weird, startingParams: weird, finalValues: weird, footerLeft: weird, zoneNote: weird, header: [[weird, weird]] },
    ));
    expect(doc.output()).toContain('x???');
  });

  it('an error event draws its text in red', () => {
    const { doc } = renderRecordPdf(model([
      { kind: 'event', time: '10:00:00', step: '(runtime)', depth: 0, text: 'Gave up after 3 attempts', performedBy: '(system)', error: true },
      { kind: 'event', time: '10:01:00', step: '(runtime)', depth: 0, text: 'Paused', performedBy: 'asmith' },
    ]));
    const content = pageContent(doc, 1);
    const colorBefore = (text: string) => {
      const ops = content.slice(0, content.indexOf(`(${text}) Tj`)).match(/[\d.]+ [\d.]+ [\d.]+ rg|[\d.]+ g(?=\n)/g) ?? [];
      return ops[ops.length - 1];
    };
    expect(colorBefore('Gave up after 3 attempts')).toBe('0.667 0. 0. rg');
    expect(colorBefore('Paused')).toBe('0.067 g');
  });

  it('long packed sections flow onto further pages without blanks', () => {
    const long = Array.from({ length: 1500 }, (_, j) => `k${j} = v${j}`).join(' · ');
    const { doc, pageCount } = renderRecordPdf(model([], { startingParams: long, finalValues: long }));
    expect(pageCount).toBeGreaterThan(1);
    expect(pageCount).toBe(doc.getNumberOfPages());
    expectNoBlankPages(doc, pageCount);
  });
});
