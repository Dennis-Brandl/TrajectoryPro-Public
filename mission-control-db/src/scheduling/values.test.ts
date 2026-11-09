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
import { resolveParams, type ResolveContext } from './values.js';

const ctx = (trigger: ResolveContext['trigger'] = null): ResolveContext => ({
  slot: { at: new Date('2026-11-09T12:00:00Z'), number: 7 },
  zone: 'America/Chicago',
  trigger,
});
const trig = (inputs: Record<string, string>, outputs: Record<string, string>) => ({ inputs, outputs });

describe('resolveParams', () => {
  it('passes a fixed value through', () => {
    expect(resolveParams({ A: { value: 'QC-7' } }, ctx())).toEqual({ ok: true, values: { A: 'QC-7' } });
  });
  it('reads a trigger input', () => {
    const r = resolveParams({ A: { from: 'trigger.input', name: 'BatchId' } }, ctx(trig({ BatchId: 'B1' }, {})));
    expect(r).toEqual({ ok: true, values: { A: 'B1' } });
  });
  it('reads a trigger output', () => {
    const r = resolveParams({ A: { from: 'trigger.output', name: 'Yield' } }, ctx(trig({}, { Yield: '97' })));
    expect(r).toEqual({ ok: true, values: { A: '97' } });
  });
  it('uses the fallback for an empty output', () => {
    const r = resolveParams(
      { A: { from: 'trigger.output', name: 'Yield', fallback: 'unknown' } },
      ctx(trig({}, { Yield: '' })),
    );
    expect(r).toEqual({ ok: true, values: { A: 'unknown' } });
  });
  it('uses the fallback for a missing output', () => {
    const r = resolveParams(
      { A: { from: 'trigger.output', name: 'Yield', fallback: 'unknown' } },
      ctx(trig({}, {})),
    );
    expect(r).toEqual({ ok: true, values: { A: 'unknown' } });
  });
  it('fails with no fallback on an empty value', () => {
    const r = resolveParams({ A: { from: 'trigger.input', name: 'BatchId' } }, ctx(trig({ BatchId: '' }, {})));
    expect(r).toEqual({ ok: false, reason: 'BatchId has no value from the triggering run' });
  });
  it('fails when there is no triggering run', () => {
    const r = resolveParams({ A: { from: 'trigger.input', name: 'BatchId' } }, ctx(null));
    expect(r).toEqual({ ok: false, reason: 'BatchId has no value from the triggering run' });
  });
  it('formats the occurrence date, datetime and number in the schedule zone', () => {
    const r = resolveParams(
      {
        D: { from: 'occurrence.date' },
        T: { from: 'occurrence.datetime' },
        N: { from: 'occurrence.number' },
      },
      ctx(),
    );
    expect(r).toEqual({ ok: true, values: { D: '2026-11-09', T: '2026-11-09T06:00', N: '7' } });
  });
  it('builds a template from occurrence placeholders', () => {
    const r = resolveParams({ A: { template: 'B-{occurrence.date}-{occurrence.number}' } }, ctx());
    expect(r).toEqual({ ok: true, values: { A: 'B-2026-11-09-7' } });
  });
  it('builds a template with trigger placeholders', () => {
    const r = resolveParams(
      { A: { template: '{trigger.input.BatchId}:{trigger.output.Yield}' } },
      ctx(trig({ BatchId: 'B1' }, { Yield: '97' })),
    );
    expect(r).toEqual({ ok: true, values: { A: 'B1:97' } });
  });
  it('a template with an empty part uses the fallback, else fails', () => {
    const t = ctx(trig({}, { Yield: '' }));
    expect(resolveParams({ A: { template: 'Y={trigger.output.Yield}', fallback: 'none' } }, t)).toEqual({
      ok: true,
      values: { A: 'none' },
    });
    expect(resolveParams({ A: { template: 'Y={trigger.output.Yield}' } }, t)).toEqual({
      ok: false,
      reason: 'Yield has no value from the triggering run',
    });
  });
  it('reports the first failing parameter', () => {
    const r = resolveParams(
      { A: { value: 'x' }, B: { from: 'trigger.output', name: 'Q' } },
      ctx(trig({}, {})),
    );
    expect(r.ok).toBe(false);
  });
});
