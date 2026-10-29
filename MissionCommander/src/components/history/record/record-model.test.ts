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
import type { RuntimeHistoryDetail, StepRunView, StepSignatureView } from '../../../lib/api/types';
import { buildRecordModel, pdfFileName } from './record-model';
import { activationRunNumbers, stepRunPathText } from './step-run-labels';

const opts = { timeZone: 'America/Chicago', now: new Date('2026-10-27T20:00:00Z'), loginName: 'dbrandl' };

function run(p: Partial<StepRunView> & { stepOid: string; stepName: string; startedAt: string | null; finishedAt: string }): StepRunView {
  return {
    id: `r-${p.stepOid}-${p.finishedAt}`, stepInstanceId: null, stepType: 'UI', runNumber: 1, result: 'completed',
    error: null, inputParameters: null, outputParameters: null, performedByLoginName: 'jdoe', performedByKind: 'user', nodePath: [], ...p,
  };
}

function base(over: Partial<RuntimeHistoryDetail> = {}): RuntimeHistoryDetail {
  return {
    id: 'h1', workflowInstanceId: null, workCenterId: 'wc', workCenterName: 'Kitchen', runtimeNumber: 7, runtimeLabel: 'RW-7',
    masterName: 'Pizza Order', masterOid: 'm', masterVersion: '1.2.0', masterState: 'Effective', finalState: 'completed',
    startedAt: '2026-10-27T15:00:00Z', finishedAt: '2026-10-27T15:10:00Z', createdAt: '2026-10-27T15:00:00Z',
    startingParams: { size: 'large', crust: 'thin' }, trace: [], properties: { total: '12.50' }, stepParams: null,
    stepNames: { eo: 'Enter Order', at: 'Add Topping', pr: 'Price', qa: 'QA Approve' },
    signatures: [], stepRuns: [], startedByLoginName: 'jdoe', startedByUserId: 'u1', userNames: { u9: 'asmith' },
    createdByLabel: null, createdByInstanceId: null, outputs: [{ name: 'receipt', value: 'R-1' }], ...over,
  };
}

const sig = (p: Partial<StepSignatureView>): StepSignatureView => ({
  id: 's1', stepOid: 'qa', stepName: 'QA Approve', signerLoginName: 'qa1', signerDisplayName: 'Quinn Ames', roleName: 'QA',
  meaning: 'Approved', decision: 'approve', outcome: 'signed', failureCode: null, signedAt: '2026-10-27T15:09:30Z', ...p,
});

function loopDetail(): RuntimeHistoryDetail {
  return base({
    stepRuns: [
      run({ stepOid: 'eo', stepName: 'Enter Order', startedAt: '2026-10-27T15:00:00Z', finishedAt: '2026-10-27T15:01:00Z', outputParameters: { size: 'large' } }),
      run({ stepOid: 'at', stepName: 'Add Topping', startedAt: '2026-10-27T15:02:00Z', finishedAt: '2026-10-27T15:03:00Z', inputParameters: { topping: 'ham' }, outputParameters: { ok: 'yes' } }),
      run({ stepOid: 'at', stepName: 'Add Topping', startedAt: '2026-10-27T15:03:00Z', finishedAt: '2026-10-27T15:04:00Z' }),
      run({ stepOid: 'at', stepName: 'Add Topping', startedAt: '2026-10-27T15:04:00Z', finishedAt: '2026-10-27T15:05:00Z', performedByLoginName: 'asmith' }),
      run({ stepOid: 'pr', stepName: 'Price', startedAt: '2026-10-27T15:06:00Z', finishedAt: '2026-10-27T15:06:00Z', performedByKind: 'script', performedByLoginName: null }),
      run({ stepOid: 'qa', stepName: 'QA Approve', startedAt: '2026-10-27T15:08:00Z', finishedAt: '2026-10-27T15:10:00Z', result: 'failed', error: 'boom' }),
    ],
    signatures: [sig({})],
  });
}

describe('buildRecordModel', () => {
  it('builds the mockup rows', () => {
    const m = buildRecordModel(loopDetail(), opts);
    const common = { kind: 'run', depth: 0, error: null, signatures: [] as string[] };
    expect(m.log).toEqual([
      { ...common, time: '10:00:00 – 10:01:00', step: 'Enter Order', run: '1', result: 'completed', performedBy: 'jdoe', params: 'Out: size = large' },
      { ...common, time: '10:02:00 – 10:03:00', step: 'Add Topping', run: '1 of 3', result: 'completed', performedBy: 'jdoe', params: 'In: topping = ham · Out: ok = yes' },
      { ...common, time: '10:03:00 – 10:04:00', step: 'Add Topping', run: '2 of 3', result: 'completed', performedBy: 'jdoe', params: null },
      { ...common, time: '10:04:00 – 10:05:00', step: 'Add Topping', run: '3 of 3', result: 'completed', performedBy: 'asmith', params: null },
      { ...common, time: '10:06:00 – 10:06:00', step: 'Price', run: '1', result: 'completed', performedBy: '(script)', params: null },
      { ...common, time: '10:08:00 – 10:10:00', step: 'QA Approve', run: '1', result: 'failed', performedBy: 'jdoe', params: null, error: 'boom',
        signatures: ['Signed by Quinn Ames (QA) · "Approved" · approve · 10:09:30'] },
    ]);
  });

  it('header and footer', () => {
    const m = buildRecordModel(loopDetail(), opts);
    expect(m.title).toBe('RW-7 · Pizza Order v1.2.0');
    expect(m.header).toEqual([
      ['Work center', 'Kitchen'], ['Final state', 'completed'], ['Started', '2026-10-27 10:00:00 by jdoe'],
      ['Finished', '2026-10-27 10:10:00'], ['Duration', '10m 00s'], ['Created by', '—'],
    ]);
    expect(m.zoneNote).toBe('Times are America/Chicago (UTC-05:00)');
    expect(m.startingParams).toBe('size = large · crust = thin');
    expect(m.finalValues).toBe('total = 12.50 · receipt = R-1');
    expect(m.footerLeft).toBe('RW-7 · Generated 2026-10-27 15:00:00 by dbrandl');
  });

  it('started-by fallbacks and empties', () => {
    const a = buildRecordModel(base({ startedByLoginName: null, createdByLabel: 'RW-3', startingParams: null, properties: null, outputs: null }), opts);
    expect(a.header[2][1]).toBe('2026-10-27 10:00:00 by (workflow)');
    expect(a.header[5][1]).toBe('RW-3');
    expect(a.startingParams).toBe('None');
    expect(a.finalValues).toBe('None');
    expect(buildRecordModel(base({ startedByLoginName: null }), opts).header[2][1]).toBe('2026-10-27 10:00:00 by not recorded');
    expect(buildRecordModel(base({ startedAt: null }), opts).header[2][1]).toBe('—');
  });

  it('run labels restart per proxy activation', () => {
    const child = (n: number, t: string) => run({
      stepOid: 'at', stepName: 'Add Topping', startedAt: `2026-10-27T15:${t}:00Z`, finishedAt: `2026-10-27T15:${t}:30Z`,
      nodePath: [{ proxyStepOid: 'px', proxyRun: n, workflowName: 'Prep' }],
    });
    const m = buildRecordModel(base({ stepRuns: [child(1, '01'), child(1, '02'), child(2, '03'), child(2, '04')] }), opts);
    const rows = m.log.filter(r => r.kind === 'run');
    expect(rows.map(r => r.kind === 'run' && r.run)).toEqual(['1 of 2', '2 of 2', '1 of 2', '2 of 2']);
    expect(rows.every(r => r.depth === 1)).toBe(true);
    expect(rows.map(r => r.step)).toEqual(['Prep › Add Topping', 'Prep › Add Topping', 'Prep (2) › Add Topping', 'Prep (2) › Add Topping']);
  });

  it('operator and failed-signature events interleave by time', () => {
    const m = buildRecordModel(base({
      stepRuns: [
        run({ stepOid: 'at', stepName: 'Add Topping', startedAt: '2026-10-27T15:00:00Z', finishedAt: '2026-10-27T15:01:00Z' }),
        run({ stepOid: 'qa', stepName: 'QA Approve', startedAt: '2026-10-27T15:05:00Z', finishedAt: '2026-10-27T15:06:00Z' }),
      ],
      trace: [
        { step_oid: 'at', state: 'OPERATOR', order: 1, timestamp: Date.parse('2026-10-27T15:02:00Z'), error: 'Force completed [by u9]' },
        { step_oid: '', state: 'OPERATOR', order: 2, timestamp: Date.parse('2026-10-27T15:03:00Z'), error: 'Paused [by zzz]' },
        { step_oid: 'at', state: 'COMPLETED', order: 3, timestamp: Date.parse('2026-10-27T15:01:00Z') },
      ],
      signatures: [sig({ outcome: 'failed', failureCode: 'bad_password', signedAt: '2026-10-27T15:04:00Z' })],
    }), opts);
    expect(m.log.map(r => r.kind === 'run' ? `run:${r.step}` : `event:${r.text}|${r.step}|${r.performedBy}`)).toEqual([
      'run:Add Topping',
      'event:Force completed|Add Topping|asmith',
      'event:Paused|(runtime)|not recorded',
      'event:Signature failed (bad_password)|QA Approve|qa1',
      'run:QA Approve',
    ]);
  });

  it('legacy run falls back to trace', () => {
    const t = (oid: string, state: string, min: number) => ({ step_oid: oid, state, order: min, timestamp: Date.parse(`2026-10-27T15:0${min}:00Z`) });
    const m = buildRecordModel(base({
      stepRuns: [],
      trace: [t('at', 'ACTIVE', 1), t('at', 'COMPLETED', 2), t('at', 'COMPLETED', 3), { ...t('pr', 'ERRORED', 4), error: 'bad' }],
      stepParams: { at: { inputParameters: { topping: 'ham' } } },
    }), opts);
    expect(m.log).toEqual([
      { kind: 'run', time: '10:02:00', step: 'Add Topping', depth: 0, run: '1 of 2', result: 'completed', performedBy: 'not recorded', params: null, signatures: [], error: null },
      { kind: 'run', time: '10:03:00', step: 'Add Topping', depth: 0, run: '2 of 2', result: 'completed', performedBy: 'not recorded', params: 'In: topping = ham', signatures: [], error: null },
      { kind: 'run', time: '10:04:00', step: 'Price', depth: 0, run: '1', result: 'failed', performedBy: 'not recorded', params: null, signatures: [], error: 'bad' },
    ]);
  });

  it('DST crossing adds offset', () => {
    const m = buildRecordModel(base({
      startedAt: '2026-11-01T06:30:00Z', finishedAt: '2026-11-01T08:30:00Z',
      stepRuns: [
        run({ stepOid: 'at', stepName: 'A', startedAt: '2026-11-01T06:30:00Z', finishedAt: '2026-11-01T06:50:00Z' }),
        run({ stepOid: 'pr', stepName: 'B', startedAt: '2026-11-01T07:10:00Z', finishedAt: '2026-11-01T08:30:00Z' }),
      ],
    }), opts);
    expect(m.log.map(r => r.time)).toEqual([
      '01:30:00 – 01:50:00',
      '01:10:00 (UTC-06:00) – 02:30:00 (UTC-06:00)',
    ]);
  });
});

describe('signatures and event edge cases', () => {
  const at = (min: string) => `2026-10-27T15:${min}:00Z`;
  const qa = (s: string, f: string | null = null) => run({ stepOid: 'qa', stepName: 'QA Approve', startedAt: f, finishedAt: s });
  it('two signers on one run print both, in signedAt order', () => {
    const m = buildRecordModel(base({
      stepRuns: [run({ stepOid: 'qa', stepName: 'QA Approve', startedAt: at('01'), finishedAt: at('09') })],
      signatures: [sig({ id: 'b', signerLoginName: 'b', signerDisplayName: null, signedAt: at('05') }), sig({ id: 'a', signedAt: at('03') })],
    }), opts);
    const r = m.log[0];
    expect(r.kind === 'run' && r.signatures).toEqual([
      'Signed by Quinn Ames (QA) · "Approved" · approve · 10:03:00',
      'Signed by b (QA) · "Approved" · approve · 10:05:00',
    ]);
  });
  it('an orphan signed signature becomes an event row', () => {
    const m = buildRecordModel(base({
      stepRuns: [run({ stepOid: 'qa', stepName: 'QA Approve', startedAt: at('01'), finishedAt: at('02') })],
      signatures: [sig({ signedAt: at('05'), meaning: null, roleName: null })],
    }), opts);
    expect(m.log[1]).toEqual({ kind: 'event', time: '10:05:00', step: 'QA Approve', depth: 0, text: 'Signed by Quinn Ames (member) · approve', performedBy: 'qa1' });
  });
  it('legacy mode prints a signed signature as an event', () => {
    const m = buildRecordModel(base({ stepRuns: [], signatures: [sig({})] }), opts);
    expect(m.log).toHaveLength(1);
    expect(m.log[0].kind).toBe('event');
  });
  it('a looped step with a null-start run claims each signature once', () => {
    const m = buildRecordModel(base({
      stepRuns: [qa(at('03')), qa(at('06'), at('04'))],
      signatures: [sig({ id: '1', signedAt: at('02') }), sig({ id: '2', signedAt: at('05') })],
    }), opts);
    const runs = m.log.map(r => r.kind === 'run' ? r.signatures.length : -1);
    expect(runs).toEqual([1, 1]);
  });
  it('user kind with no login reads not recorded', () => {
    const m = buildRecordModel(base({ stepRuns: [run({ stepOid: 'at', stepName: 'A', startedAt: at('01'), finishedAt: at('02'), performedByLoginName: null })] }), opts);
    expect(m.log[0].performedBy).toBe('not recorded');
  });
  it('blank operator text and null failure code', () => {
    const m = buildRecordModel(base({
      trace: [{ step_oid: '', state: 'OPERATOR', order: 1, timestamp: Date.parse(at('01')) }],
      signatures: [sig({ outcome: 'failed', failureCode: null, signedAt: at('02') })],
    }), opts);
    expect(m.log.map(r => r.kind === 'event' && r.text)).toEqual(['Operator action', 'Signature failed']);
  });
});

describe('final review fixes', () => {
  const at = (min: string) => `2026-10-27T15:${min}:00Z`;
  const tr = (oid: string, state: string, min: string, error?: string) =>
    ({ step_oid: oid, state, order: Number(min), timestamp: Date.parse(at(min)), ...(error !== undefined ? { error } : {}) });

  it('an instance-level error shows as a red (runtime) event in step-run mode', () => {
    const m = buildRecordModel(base({
      stepRuns: [run({ stepOid: 'at', stepName: 'Add Topping', startedAt: at('01'), finishedAt: at('02') })],
      trace: [tr('', 'ERRORED', '03', 'Gave up after 3 failed start attempts'), tr('', 'ERRORED', '04'), tr('at', 'ERRORED', '05', 'step-level')],
    }), opts);
    expect(m.log.slice(1)).toEqual([
      { kind: 'event', time: '10:03:00', step: '(runtime)', depth: 0, text: 'Gave up after 3 failed start attempts', performedBy: '(system)', error: true },
      { kind: 'event', time: '10:04:00', step: '(runtime)', depth: 0, text: 'Error', performedBy: '(system)', error: true },
    ]);
  });

  it('steps finished before the first step run (a run in flight at deploy) come from the trace', () => {
    const m = buildRecordModel(base({
      stepRuns: [
        run({ stepOid: 'pr', stepName: 'Price', startedAt: at('05'), finishedAt: at('06'), performedByKind: 'script', performedByLoginName: null }),
        run({ stepOid: 'qa', stepName: 'QA Approve', startedAt: null, finishedAt: at('08') }),
      ],
      trace: [
        tr('eo', 'COMPLETED', '01'), tr('at', 'COMPLETED', '02'), tr('at', 'COMPLETED', '03'),
        tr('pr', 'COMPLETED', '06'), tr('qa', 'COMPLETED', '08'),
      ],
      stepParams: { at: { inputParameters: { topping: 'ham' } } },
    }), opts);
    expect(m.log.map(r => r.kind === 'run' && [r.time, r.step, r.run, r.performedBy, r.params])).toEqual([
      ['10:01:00', 'Enter Order', '1', 'not recorded', null],
      ['10:02:00', 'Add Topping', '1 of 2', 'not recorded', null],
      ['10:03:00', 'Add Topping', '2 of 2', 'not recorded', null],
      ['10:05:00 – 10:06:00', 'Price', '1', '(script)', null],
      ['10:08:00', 'QA Approve', '1', 'jdoe', null],
    ]);
  });

  it('a user step that did not complete and has no login reads —', () => {
    const results = ['aborted', 'stopped', 'cancelled', 'failed', 'caught', 'completed'] as const;
    const m = buildRecordModel(base({
      stepRuns: results.map((result, i) => run({ stepOid: `s${i}`, stepName: `S${i}`, startedAt: at('01'), finishedAt: at('02'), result, performedByLoginName: null })),
    }), opts);
    expect(m.log.map(r => r.performedBy)).toEqual(['—', '—', '—', '—', '—', 'not recorded']);
  });

  it('a later proxy run shows its number in the path', () => {
    const child = (n: number, t: string) => run({
      stepOid: 'at', stepName: 'Add Topping', startedAt: at(t), finishedAt: at(t),
      nodePath: [{ proxyStepOid: 'px', proxyRun: n, workflowName: 'Prep' }],
    });
    const m = buildRecordModel(base({ stepRuns: [child(1, '01'), child(2, '02'), child(2, '03')] }), opts);
    expect(m.log.map(r => r.kind === 'run' && [r.step, r.run])).toEqual([
      ['Prep › Add Topping', '1'], ['Prep (2) › Add Topping', '1 of 2'], ['Prep (2) › Add Topping', '2 of 2'],
    ]);
  });
});

describe('step-run labels', () => {
  const node = (proxyRun: number, workflowName: string) => ({ proxyStepOid: workflowName, proxyRun, workflowName });
  it('path text numbers later proxy runs only', () => {
    expect(stepRunPathText({ nodePath: [] })).toBe('');
    expect(stepRunPathText({ nodePath: [node(1, 'Make Pizza'), node(2, 'Toppings')] })).toBe('Make Pizza › Toppings (2)');
  });
  it('activation run numbers restart per proxy run and match runNumber at the root', () => {
    const r = (stepOid: string, proxyRun?: number) => ({ stepOid, nodePath: proxyRun ? [node(proxyRun, 'Prep')] : [] });
    expect(activationRunNumbers([r('a'), r('a'), r('c', 1), r('c', 1), r('c', 2), r('a')])).toEqual([1, 2, 1, 2, 1, 3]);
  });
});

describe('pdfFileName', () => {
  it('sanitises', () => {
    expect(pdfFileName({ runtimeLabel: 'RW/7: "x"', masterName: 'Pizza*Order' })).toBe('RW_7_ _x_ - Pizza_Order.pdf');
  });
});
