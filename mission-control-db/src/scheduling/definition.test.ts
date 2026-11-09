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

import { describe, expect, it } from 'vitest';
import { parseScheduleDefinition } from './definition.js';

const recurrence = { type: 'once', at: '2026-11-10T06:00' };
const def = (items: unknown, extra: Record<string, unknown> = {}) => ({ name: 'S', recurrence, items, ...extra });
const wf = (name = 'W') => ({ workflow: { name } });
const chained = (name: string, extra: Record<string, unknown> = {}) => ({
  ...wf(name),
  triggerOn: ['completed'],
  ...extra,
});
const problemsOf = (input: unknown) => {
  const r = parseScheduleDefinition(input);
  return r.ok ? [] : r.problems;
};
/** One start-list item with a single chained child per level below it. */
function deep(levels: number): Record<string, unknown> {
  let node: Record<string, unknown> = levels === 1 ? wf('L1') : chained(`L${levels}`);
  for (let i = levels - 1; i >= 1; i--) {
    node = { ...(i === 1 ? wf('L1') : chained(`L${i}`)), chain: [node] };
  }
  return node;
}

describe('parseScheduleDefinition', () => {
  it('accepts the spec example shape', () => {
    const r = parseScheduleDefinition(
      def(
        [
          {
            workflow: { name: 'Blend Batch' },
            params: { BatchId: { value: 'B-1' }, N: { template: 'B-{occurrence.date}' } },
            chain: [
              {
                workflow: { name: 'Lab Test', version: '2.0' },
                triggerOn: ['completed', 'errored'],
                params: { BatchId: { from: 'trigger.input', name: 'BatchId', fallback: 'x' } },
              },
            ],
          },
        ],
        { description: 'd' },
      ),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.name).toBe('S');
      expect(r.value.items[0]!.chain![0]!.workflow.version).toBe('2.0');
    }
  });

  it('accepts 100 items and 8 levels', () => {
    const items = Array.from({ length: 100 }, (_, i) => wf(`W${i}`));
    expect(parseScheduleDefinition(def(items)).ok).toBe(true);
    expect(parseScheduleDefinition(def([deep(8)])).ok).toBe(true);
  });

  it('rejects 101 items, counting chained ones', () => {
    const items = Array.from({ length: 101 }, (_, i) => wf(`W${i}`));
    expect(problemsOf(def(items)).some((p) => p.code === 'TOO_MANY_ITEMS')).toBe(true);
    const nested = [{ ...wf('A'), chain: Array.from({ length: 100 }, (_, i) => chained(`C${i}`)) }];
    expect(problemsOf(def(nested)).some((p) => p.code === 'TOO_MANY_ITEMS')).toBe(true);
  });

  it('rejects 9 levels', () => {
    expect(problemsOf(def([deep(9)])).some((p) => p.code === 'TOO_DEEP')).toBe(true);
  });

  it('rejects a chained item with no triggerOn, or an empty one', () => {
    const a = problemsOf(def([{ ...wf(), chain: [wf('B')] }]));
    expect(a).toContainEqual(expect.objectContaining({ path: 'items[0].chain[0].triggerOn', code: 'TRIGGER_ON_REQUIRED' }));
    const b = problemsOf(def([{ ...wf(), chain: [chained('B', { triggerOn: [] })] }]));
    expect(b).toContainEqual(expect.objectContaining({ path: 'items[0].chain[0].triggerOn', code: 'TRIGGER_ON_REQUIRED' }));
  });

  it('rejects an unknown ending', () => {
    const p = problemsOf(def([{ ...wf(), chain: [chained('B', { triggerOn: ['completed', 'exploded'] })] }]));
    expect(p).toContainEqual(expect.objectContaining({ path: 'items[0].chain[0].triggerOn[1]', code: 'TRIGGER_ON_INVALID' }));
  });

  it('rejects triggerOn on a start-list item', () => {
    const p = problemsOf(def([{ ...wf(), triggerOn: ['completed'] }]));
    expect(p).toContainEqual(expect.objectContaining({ path: 'items[0].triggerOn' }));
  });

  it('rejects trigger.* sources and placeholders on a start-list item', () => {
    const p = problemsOf(
      def([
        {
          ...wf(),
          params: {
            A: { from: 'trigger.input', name: 'X' },
            B: { template: '{trigger.output.Y}' },
          },
        },
      ]),
    );
    expect(p.map((x) => x.path)).toEqual(['items[0].params.A', 'items[0].params.B']);
  });

  it('rejects unknown value-source keys and unknown placeholders', () => {
    const p = problemsOf(
      def([
        {
          ...wf(),
          params: {
            A: { value: 'x', extra: 1 },
            B: { template: 'x{occurrence.bogus}' },
            C: { from: 'occurrence.nope' },
            D: { from: 'trigger.input' },
            E: {},
            F: { value: 1 },
          },
        },
      ]),
    );
    expect(p.map((x) => x.path)).toEqual([
      'items[0].params.A',
      'items[0].params.B',
      'items[0].params.C',
      'items[0].params.D',
      'items[0].params.E',
      'items[0].params.F',
    ]);
  });

  it('returns every problem together with full paths', () => {
    const p = problemsOf({
      name: '',
      recurrence: { type: 'nope' },
      items: [
        {
          workflow: { name: 'A' },
          chain: [
            chained('B'),
            { ...wf('C'), triggerOn: ['completed'], params: { BatchId: { from: 'bogus', name: 'x' } } },
          ],
        },
      ],
    });
    const paths = p.map((x) => x.path);
    expect(paths).toContain('name');
    expect(paths).toContain('recurrence');
    expect(paths).toContain('items[0].chain[1].params.BatchId');
  });

  it('applies the every caps through the recurrence', () => {
    const r = { type: 'interval', every: 525_601, unit: 'minutes', startAt: '2026-11-10T06:00' };
    expect(problemsOf(def([wf()], { recurrence: r })).map((x) => x.path)).toEqual(['recurrence']);
  });

  it('rejects non-object input and missing items', () => {
    expect(parseScheduleDefinition(null).ok).toBe(false);
    expect(problemsOf(def([])).length).toBeGreaterThan(0);
    expect(problemsOf({ name: 'x', recurrence }).length).toBeGreaterThan(0);
  });
});

describe('parseScheduleDefinition refuses unknown fields', () => {
  const rows = (input: unknown) => problemsOf(input).filter((p) => p.code === 'UNKNOWN_FIELD').map((p) => p.path);

  it('at the top, on items at any depth, on workflow, one row per field', () => {
    expect(rows(def([wf()], { nmae: 'x', itemz: [] }))).toEqual(['nmae', 'itemz']);
    expect(rows(def([{ ...wf(), parms: {}, chains: [] }]))).toEqual(['items[0].parms', 'items[0].chains']);
    expect(rows(def([{ workflow: { name: 'W', versoin: '1' } }]))).toEqual(['items[0].workflow.versoin']);
    expect(rows(def([{ ...wf(), chain: [chained('C', { parms: {} })] }]))).toEqual(['items[0].chain[0].parms']);
  });

  it('in the recurrence and its range, with the recurrence path', () => {
    const daily = { type: 'daily', every: 1, weekdayOnly: true, times: ['06:00'], range: { startDate: '2026-11-01', noEnd: true, rangee: 1 } };
    expect(rows(def([wf()], { recurrence: daily }))).toEqual(['recurrence.weekdayOnly', 'recurrence.range.rangee']);
  });

  it('keeps the other problems alongside them', () => {
    const codes = problemsOf({ name: '', recurrence: { type: 'once', at: 'bad', extra: 1 }, items: [wf()] }).map((p) => p.code);
    expect(codes).toEqual(expect.arrayContaining(['NAME_REQUIRED', 'UNKNOWN_FIELD', 'RECURRENCE_INVALID']));
    expect(problemsOf({ name: 'S', recurrence: { type: 'once', at: '2026-11-10T06:00', extra: 1 }, items: [wf()] })
      .filter((p) => p.code === 'RECURRENCE_INVALID')).toEqual([]);
  });
});

describe('parseScheduleDefinition refuses NUL characters', () => {
  it('names the place of each, in values and in keys', () => {
    const paths = problemsOf(def([{ workflow: { name: 'W' }, params: { 'P\u0000': { value: 'x' }, Q: { value: 'a\u0000' } } }], { description: 'b\u0000' }))
      .filter((p) => p.code === 'TEXT_INVALID').map((p) => p.path);
    expect(paths).toEqual(expect.arrayContaining(['description', 'items[0].params.Q.value']));
    expect(paths).toHaveLength(3);
  });

  it('leaves a backslash followed by u0000 alone', () => {
    expect(parseScheduleDefinition(def([wf()], { description: 'C:\\u0000' })).ok).toBe(true);
  });
});

describe('parseScheduleDefinition refuses lone surrogates', () => {
  it('names the place of each, in values and in keys, with TEXT_INVALID', () => {
    const paths = problemsOf(def([{ workflow: { name: 'W\ud800' }, params: { 'P\udc00': { value: 'x' }, Q: { value: 'a\ud800b' } } }], { name: '\udc00S' }))
      .filter((p) => p.code === 'TEXT_INVALID').map((p) => p.path);
    expect(paths).toEqual(expect.arrayContaining(['name', 'items[0].workflow.name', 'items[0].params.Q.value']));
    expect(paths).toHaveLength(4);
  });

  it('keeps a real surrogate pair', () => {
    expect(parseScheduleDefinition(def([wf('Mix \ud83d\ude00')], { description: '\ud83d\ude00' })).ok).toBe(true);
  });
});

describe('parseScheduleDefinition stops on a hostile body', () => {
  const nestedArrays = (n: number) => JSON.parse(`${'['.repeat(n)}${']'.repeat(n)}`);
  const nestedObjects = (n: number) => JSON.parse(`${'{"a":'.repeat(n)}1${'}'.repeat(n)}`);
  const refusedAsTooDeep = (input: unknown) => {
    const r = parseScheduleDefinition(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.map((p) => p.code)).toContain('NESTED_TOO_DEEP');
  };

  it('refuses 10,000 levels of nesting wherever they sit, without a stack overflow', () => {
    for (const deep of [nestedArrays(10_000), nestedObjects(10_000)]) {
      refusedAsTooDeep(def([wf()], { description: deep }));
      refusedAsTooDeep(def([wf()], { bogus: deep }));
      refusedAsTooDeep(def([{ ...wf(), params: { P: deep } }]));
      refusedAsTooDeep(def([{ ...wf(), chain: [{ ...wf('C'), triggerOn: [deep] }] }]));
      refusedAsTooDeep(def([wf()], { recurrence: { type: 'daily', every: 1, times: [deep], range: { startDate: '2026-11-01', noEnd: true } } }));
    }
  });

  it('allows 64 levels and refuses the 65th as nesting', () => {
    // The body is level 1 and `bogus` adds a level, so an array of depth n reaches level n + 1.
    const codes = (n: number) => problemsOf(def([wf()], { bogus: nestedArrays(n) })).map((p) => p.code);
    expect(codes(63)).not.toContain('NESTED_TOO_DEEP');
    expect(codes(64)).toContain('NESTED_TOO_DEEP');
  });

  it('stops after 20 problems, whatever kind they are', () => {
    const many = Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`bad${i}`, 'x']));
    expect(problemsOf(def([wf()], many))).toHaveLength(20);
    const nuls = Array.from({ length: 5000 }, () => 'a\u0000');
    expect(problemsOf(def([wf()], { description: nuls }))).toHaveLength(20);
    const items = Array.from({ length: 5000 }, () => ({}));
    expect(problemsOf(def(items))).toHaveLength(20);
  });

  it('20 problems found first do not let a deep value through to the rest of the checks', () => {
    const nuls = Array.from({ length: 20 }, () => 'a\u0000');
    const trigger = { ...wf('C'), triggerOn: [nestedArrays(10_000)] };
    // description comes first, so the walk stops on its problems before it reaches items.
    const body = { description: nuls, ...def([{ ...wf(), chain: [trigger] }]) };
    expect(problemsOf(body).map((p) => p.code)).toEqual(Array(20).fill('TEXT_INVALID'));
  });
});
