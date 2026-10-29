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

// Step-run labels shared by the record PDF model and the History detail dialog. Kept apart from
// record-model.ts so the dialog can use them without loading the PDF modules up front.
import type { StepRunView } from '../../../lib/api/types';

/** The sub-workflow path of a step run, outermost first; a later activation of a WORKFLOW
 *  PROXY shows its run, e.g. "Prep (2) › Toppings". Empty for a root step. */
export function stepRunPathText(r: Pick<StepRunView, 'nodePath'>): string {
  return r.nodePath.map(n => (n.proxyRun > 1 ? `${n.workflowName} (${n.proxyRun})` : n.workflowName)).join(' › ');
}

/** Groups one step's runs within one sub-workflow activation (the path carries each proxy run). */
export const stepRunGroupKey = (r: Pick<StepRunView, 'stepOid' | 'nodePath'>): string => r.stepOid + JSON.stringify(r.nodePath);

/** For each key, its position within its group (k, from 1) and the group's size (n). */
export function positionsInGroups(keys: string[]): Array<{ k: number; n: number }> {
  const total = new Map<string, number>();
  for (const key of keys) total.set(key, (total.get(key) ?? 0) + 1);
  const seen = new Map<string, number>();
  return keys.map(key => {
    const k = (seen.get(key) ?? 0) + 1;
    seen.set(key, k);
    return { k, n: total.get(key)! };
  });
}

/** Each run's number within its activation: same as runNumber for a root step; a child step's
 *  count restarts with each run of its WORKFLOW PROXY. Runs must be in run order. */
export function activationRunNumbers(runs: Array<Pick<StepRunView, 'stepOid' | 'nodePath'>>): number[] {
  return positionsInGroups(runs.map(stepRunGroupKey)).map(p => p.k);
}
