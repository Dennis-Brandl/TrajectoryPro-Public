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
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import type { RecordModel } from '@/components/history/record/record-model';
import { RecordView } from './RecordView';

afterEach(cleanup);

const model: RecordModel = {
  title: 'Mix batch — RW-7', header: [['Runtime', 'RW-7'], ['Result', 'completed'], ['Started', '09:00'], ['Finished', '09:30']],
  zoneNote: 'Times in Europe/Paris', startingParams: 'Batch = 12',
  log: [
    { kind: 'run', time: '09:01', step: 'Weigh', depth: 1, run: '1', result: 'completed', performedBy: 'ann', params: 'In: kg = 4', signatures: ['Signed by Ann Lee (QA) · "Approved"'], error: null },
    { kind: 'event', time: '09:05', step: 'Mix', depth: 0, text: 'Paused by sam', performedBy: 'sam' },
    { kind: 'run', time: '09:10', step: 'Mix', depth: 0, run: '2 of 2', result: 'failed', performedBy: 'bob', params: null, signatures: [], error: 'Motor stalled' },
  ],
  finalValues: 'Yield = 9', footerLeft: 'footer',
};

describe('RecordView', () => {
  it('orders the headings like the PDF', () => {
    render(<RecordView model={model} layout="desktop" />);
    const heads = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(heads).toEqual(['Starting parameters', 'Step log', 'Outputs']);
    expect(screen.getByText('Batch = 12')).toBeInTheDocument();
    expect(screen.getByText('Yield = 9')).toBeInTheDocument();
    expect(screen.queryByText('footer')).toBeNull();
  });
  it('desktop table: exact header, PDF structure of event and extra rows', () => {
    render(<RecordView model={model} layout="desktop" />);
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['Time', 'Step', 'Run', 'Result', 'Performed by']);
    const rows = within(table).getAllByRole('row').slice(1);
    // run, params, signature, event, run, error
    expect(rows.map((r) => r.textContent?.slice(0, 5))).toEqual(['09:01', 'In: k', 'Signe', '09:05', '09:10', 'Motor']);
    const tds = (r: HTMLElement) => Array.from(r.querySelectorAll('td'));
    expect(tds(rows[1])).toHaveLength(1);
    expect(tds(rows[1])[0].getAttribute('colspan')).toBe('5');
    expect(tds(rows[1])[0].style.color).toBe('rgb(51, 51, 51)');
    expect(tds(rows[1])[0].style.paddingLeft).toBe('24px');
    expect(tds(rows[2])[0].getAttribute('colspan')).toBe('5');
    expect(tds(rows[2])[0].textContent).toMatch(/Signed by Ann Lee/);
    expect(tds(rows[5])[0].getAttribute('colspan')).toBe('5');
    expect(tds(rows[5])[0].textContent).toBe('Motor stalled');
    // event: step in its own cell, text spans Run+Result
    const ev = tds(rows[3]);
    expect(ev.map((c) => c.textContent)).toEqual(['09:05', 'Mix', 'Paused by sam', 'sam']);
    expect(ev[2].getAttribute('colspan')).toBe('2');
    expect(rows[3].style.fontStyle).toBe('');
    expect(tds(rows[0])[1].style.paddingLeft).toBe('14px');
  });
  it('desktop header shows two pairs per row; phone one per row', () => {
    const { container, rerender } = render(<RecordView model={model} layout="desktop" />);
    expect(container.querySelector('dl')!.style.gridTemplateColumns).toBe('80px 1fr 80px 1fr');
    rerender(<RecordView model={model} layout="phone" />);
    expect(container.querySelector('dl')!.style.gridTemplateColumns).toBe('1fr');
  });
  it('an empty log says so instead of an empty table', () => {
    render(<RecordView model={{ ...model, log: [] }} layout="desktop" />);
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('No step runs recorded.')).toBeInTheDocument();
  });
  it('phone: no table, each row has time, step and result', () => {
    render(<RecordView model={model} layout="phone" />);
    expect(screen.queryByRole('table')).toBeNull();
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toContain('09:01');
    expect(items[0].textContent).toContain('Weigh');
    expect(items[0].textContent).toContain('completed');
    expect(items[0].textContent).not.toContain('run 1');
    expect(items[2].textContent).toContain('run 2 of 2');
    expect(items[2].textContent).toContain('failed');
    expect(items[0].textContent).toContain('ann');
  });
});
