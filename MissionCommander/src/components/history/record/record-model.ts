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

import type { RuntimeHistoryDetail, StepRunView, StepSignatureView } from '../../../lib/api/types';
import { formatDuration } from '../format-duration';
import { makeTimeFormatter } from './record-time';
import { positionsInGroups, stepRunGroupKey, stepRunPathText } from './step-run-labels';

export type RecordLogRow =
  | { kind: 'run'; time: string; step: string; depth: number; run: string; result: string; performedBy: string; params: string | null; signatures: string[]; error: string | null }
  | { kind: 'event'; time: string; step: string; depth: number; text: string; performedBy: string; error?: true };

export type RecordModel = {
  title: string;
  header: Array<[label: string, value: string]>;
  zoneNote: string;
  startingParams: string;
  log: RecordLogRow[];
  finalValues: string;
  footerLeft: string;
};

const NOT_RECORDED = 'not recorded';

const pack = (entries: Array<[string, string]>) => entries.map(([k, v]) => `${k} = ${v}`).join(' · ');

/** In/Out text for one step run, leaving out an empty side; null when both are empty. */
function packRunParams(input: Record<string, string> | null | undefined, output: Record<string, string> | null | undefined): string | null {
  const parts: string[] = [];
  const i = Object.entries(input ?? {});
  const o = Object.entries(output ?? {});
  if (i.length > 0) parts.push(`In: ${pack(i)}`);
  if (o.length > 0) parts.push(`Out: ${pack(o)}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** "k of n" per step oid within one sub-workflow activation (the path), "1" when it ran once. */
function runLabels(keys: string[]): string[] {
  return positionsInGroups(keys).map(({ k, n }) => (n === 1 ? '1' : `${k} of ${n}`));
}

export function buildRecordModel(detail: RuntimeHistoryDetail, opts: { timeZone: string; now: Date; loginName: string }): RecordModel {
  const reference = detail.startedAt ?? detail.finishedAt;
  const fmt = makeTimeFormatter(opts.timeZone, reference);
  const stepNames = detail.stepNames ?? {};
  const nameOf = (oid: string) => stepNames[oid] ?? oid;

  type Keyed = { sortMs: number; row: RecordLogRow };
  const keyed: Keyed[] = [];

  const signedAll = detail.signatures.filter(x => x.outcome === 'signed')
    .sort((a, b) => new Date(a.signedAt).getTime() - new Date(b.signedAt).getTime());
  const signatureText = (s: StepSignatureView, withTime: boolean) => [
    `Signed by ${s.signerDisplayName ?? s.signerLoginName} (${s.roleName ?? 'member'})`,
    ...(s.meaning !== null ? [`"${s.meaning}"`] : []),
    ...(s.decision !== null ? [s.decision] : []),
    ...(withTime ? [fmt.time(s.signedAt, reference)] : []),
  ].join(' · ');
  // Each signed signature belongs to exactly one run: same step, covering signedAt, earliest finish.
  const claimed = new Map<number, string[]>();
  const orphans: StepSignatureView[] = [];
  for (const s of signedAll) {
    const at = new Date(s.signedAt).getTime();
    let best = -1;
    detail.stepRuns.forEach((r, i) => {
      if (r.stepOid !== s.stepOid || new Date(r.finishedAt).getTime() < at) return;
      if (r.startedAt !== null && new Date(r.startedAt).getTime() > at) return;
      if (best < 0 || new Date(r.finishedAt).getTime() < new Date(detail.stepRuns[best].finishedAt).getTime()) best = i;
    });
    if (best < 0) orphans.push(s);
    else claimed.set(best, [...(claimed.get(best) ?? []), signatureText(s, true)]);
  }

  // Trace-only run rows: performer not recorded, the trace time, and (withParams) the step's
  // last-run params on its last entry — all the trace keeps. Labels count these rows only.
  const pushTraceRuns = (entries: typeof detail.trace, withParams: boolean) => {
    const labels = runLabels(entries.map(t => t.step_oid));
    const lastIdx = new Map<string, number>();
    entries.forEach((t, i) => lastIdx.set(t.step_oid, i));
    entries.forEach((t, i) => {
      const p = withParams && lastIdx.get(t.step_oid) === i ? detail.stepParams?.[t.step_oid] : undefined;
      keyed.push({
        sortMs: t.timestamp,
        row: {
          kind: 'run', time: fmt.time(t.timestamp, reference), step: nameOf(t.step_oid), depth: 0, run: labels[i],
          result: t.state === 'COMPLETED' ? 'completed' : t.state === 'ERRORED' ? 'failed' : 'aborted',
          performedBy: NOT_RECORDED, params: packRunParams(p?.inputParameters, p?.outputParameters),
          signatures: [], error: t.error ?? null,
        },
      });
    });
  };
  const isRunEnd = (t: (typeof detail.trace)[number]) => t.state === 'COMPLETED' || t.state === 'ERRORED' || t.state === 'ABORTED';

  if (detail.stepRuns.length > 0) {
    // A run in flight at deploy has no step_run rows for the steps it finished before then:
    // take those from the trace, as a legacy record would (no backfill).
    const firstRunMs = Math.min(...detail.stepRuns.map(r => new Date(r.startedAt ?? r.finishedAt).getTime()));
    pushTraceRuns(detail.trace.filter(t => isRunEnd(t) && !!t.step_oid && t.timestamp < firstRunMs), false);
    // An instance-level failure (invalid spec, start attempts given up) has no step and no
    // step_run row; the trace is its only record.
    for (const t of detail.trace) {
      if (t.state !== 'ERRORED' || t.step_oid) continue;
      keyed.push({
        sortMs: t.timestamp,
        row: { kind: 'event', time: fmt.time(t.timestamp, reference), step: '(runtime)', depth: 0, text: t.error || 'Error', performedBy: '(system)', error: true },
      });
    }
    const labels = runLabels(detail.stepRuns.map(stepRunGroupKey));
    detail.stepRuns.forEach((r, i) => {
      const finishMs = new Date(r.finishedAt).getTime();
      keyed.push({
        sortMs: r.startedAt !== null ? new Date(r.startedAt).getTime() : finishMs,
        row: {
          kind: 'run',
          time: r.startedAt !== null ? `${fmt.time(r.startedAt, reference)} – ${fmt.time(r.finishedAt, reference)}` : fmt.time(r.finishedAt, reference),
          step: r.nodePath.length > 0 ? `${stepRunPathText(r)} › ${r.stepName}` : r.stepName,
          depth: r.nodePath.length, run: labels[i], result: r.result, performedBy: performedBy(r),
          params: packRunParams(r.inputParameters, r.outputParameters),
          signatures: claimed.get(i) ?? [], error: r.error,
        },
      });
    });
  } else {
    pushTraceRuns(detail.trace.filter(isRunEnd), true);
  }

  for (const t of detail.trace) {
    if (t.state !== 'OPERATOR') continue;
    const by = /\s*\[by ([^\]]+)\]\s*$/.exec(t.error ?? '');
    keyed.push({
      sortMs: t.timestamp,
      row: {
        kind: 'event', time: fmt.time(t.timestamp, reference), step: t.step_oid === '' ? '(runtime)' : nameOf(t.step_oid), depth: 0,
        text: (t.error ?? '').replace(/\s*\[by [^\]]+\]\s*$/, '') || 'Operator action',
        performedBy: (by ? detail.userNames[by[1]] : undefined) ?? NOT_RECORDED,
      },
    });
  }
  for (const s of detail.signatures) {
    if (s.outcome !== 'failed') continue;
    keyed.push({
      sortMs: new Date(s.signedAt).getTime(),
      row: { kind: 'event', time: fmt.time(s.signedAt, reference), step: s.stepName, depth: 0, text: s.failureCode ? `Signature failed (${s.failureCode})` : 'Signature failed', performedBy: s.signerLoginName },
    });
  }
  for (const s of orphans) {
    keyed.push({
      sortMs: new Date(s.signedAt).getTime(),
      row: { kind: 'event', time: fmt.time(s.signedAt, reference), step: s.stepName, depth: 0, text: signatureText(s, false), performedBy: s.signerLoginName },
    });
  }
  // Array.prototype.sort is stable: runs keep API order, and a tie puts runs before events.
  keyed.sort((a, b) => a.sortMs - b.sortMs);

  function performedBy(r: StepRunView): string {
    if (r.performedByKind !== 'user') return `(${r.performedByKind})`;
    // A user step that ended any other way than completed had nobody submit it — nothing is missing.
    return r.performedByLoginName ?? (r.result === 'completed' ? NOT_RECORDED : '—');
  }

  // The workflow's output parameters only. `properties` is the whole store, starting parameters included.
  const final = (detail.outputs ?? []).map((o): [string, string] => [o.name, o.value]);
  const startedBy = detail.startedByLoginName ?? (detail.createdByLabel ? '(workflow)' : NOT_RECORDED);

  return {
    title: `${detail.runtimeLabel} · ${detail.masterName} v${detail.masterVersion}`,
    header: [
      ['Work center', detail.workCenterName],
      ['Final state', detail.finalState],
      ['Started', detail.startedAt !== null ? `${fmt.dateTime(detail.startedAt)} by ${startedBy}` : '—'],
      ['Finished', fmt.dateTime(detail.finishedAt)],
      ['Duration', formatDuration(detail.startedAt, detail.finishedAt)],
      ['Created by', detail.createdByLabel ?? '—'],
    ],
    zoneNote: `Times are ${fmt.zoneLabel}`,
    startingParams: detail.startingParams && Object.keys(detail.startingParams).length > 0 ? pack(Object.entries(detail.startingParams)) : 'None',
    log: keyed.map(k => k.row),
    finalValues: final.length > 0 ? pack(final) : 'None',
    footerLeft: `${detail.runtimeLabel} · Generated ${fmt.dateTime(opts.now.getTime())} by ${opts.loginName}`,
  };
}

export function pdfFileName(detail: Pick<RuntimeHistoryDetail, 'runtimeLabel' | 'masterName'>): string {
  const clean = (s: string) => s.replace(/[\\/:*?"<>|]/g, '_').trim();
  return `${clean(detail.runtimeLabel)} - ${clean(detail.masterName)}.pdf`;
}
