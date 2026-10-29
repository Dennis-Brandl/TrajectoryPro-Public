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

export type ActionKey = 'create' | 'createStart' | 'start' | 'stop' | 'abort' | 'suspend' | 'unsuspend' | 'status' | 'wait' | 'outputs';
export type ActionDef = { key: ActionKey; name: string; oid: string; inputs: string[] };

/** The environment the GLOBAL "Distributed Workflow Environment Library" defines. Loose matching
 *  (MissionEngine actions/invoker.ts) needs this exact name. */
export const BROKER_ENV = { oid: 'broker-env', name: 'Distributed Workflow Management' } as const;

const CREATE_INPUTS = ['WorkCenter', 'Workflow', 'StartingParameters'];
const REF_INPUTS = ['RuntimeWorkflow'];

/** Names exactly as the GLOBAL "Distributed Workflow Action Library" (spec §1, R9). */
export const ACTIONS: ActionDef[] = [
  { key: 'create', name: 'Create Runtime Workflow', oid: 'broker-create', inputs: CREATE_INPUTS },
  { key: 'createStart', name: 'Create and Start Runtime Workflow', oid: 'broker-create-start', inputs: CREATE_INPUTS },
  { key: 'start', name: 'Start Runtime Workflow', oid: 'broker-start', inputs: REF_INPUTS },
  { key: 'stop', name: 'Stop Runtime Workflow', oid: 'broker-stop', inputs: REF_INPUTS },
  { key: 'abort', name: 'Abort Runtime Workflow', oid: 'broker-abort', inputs: REF_INPUTS },
  { key: 'suspend', name: 'Suspend Runtime Workflow', oid: 'broker-suspend', inputs: REF_INPUTS },
  { key: 'unsuspend', name: 'Unsuspend Runtime Workflow', oid: 'broker-unsuspend', inputs: REF_INPUTS },
  { key: 'status', name: 'Get Runtime Workflow Status', oid: 'broker-status', inputs: REF_INPUTS },
  { key: 'wait', name: 'Wait for Runtime Workflow', oid: 'broker-wait', inputs: REF_INPUTS },
  { key: 'outputs', name: 'Get Runtime Workflow Outputs', oid: 'broker-outputs', inputs: REF_INPUTS },
];

/** Loose matching invokes our own oid; strict matching invokes Designer's spec id, which changes
 *  with every new version — so the calling step's own action name is the fallback. */
export function findAction(oid: string, actionName: string | null): ActionDef | null {
  const byOid = ACTIONS.find((a) => a.oid === oid);
  if (byOid) return byOid;
  if (!actionName) return null;
  return ACTIONS.find((a) => a.name === actionName)
    ?? ACTIONS.find((a) => a.name.toLowerCase() === actionName.trim().toLowerCase())
    ?? null;
}
