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

import {
  createRuntime, commandRuntime, getRuntimeState, getRuntimeOutputs, RemoteError, REMOTE_CODES, type Caller,
} from 'mission-control-db/src/runtime/remote-control/index';
import type { ActionDef } from './catalog.js';
import { completionOutputs, group, readInput, readStartingParameters, type Param } from './wire.js';
import type { Db } from './store.js';

export type Execution =
  | { state: 'COMPLETED'; outputs: Param[] }
  | { state: 'RUNNING'; targetInstanceId: string };

/** Every output Value Property this action returns, valued for a refusal (blank data). */
function blanks(action: ActionDef): Param[] {
  switch (action.key) {
    case 'create': case 'createStart': return [{ name: 'RuntimeWorkflow', value: group({ ID: '', Label: '' }) }];
    case 'status': case 'wait': return [{ name: 'Runtime', value: group({ State: 'Unknown' }) }];
    case 'outputs': return [{ name: 'Runtime', value: group({ State: 'Unknown' }) }, { name: 'Outputs', value: '[]' }];
    default: return [];
  }
}

const ok = (data: Param[]): Execution => ({ state: 'COMPLETED', outputs: [...completionOutputs(0, ''), ...data] });

/** One Distributed Workflow action (spec section 1 + R9). Refusals are data, never protocol errors:
 *  the workflow reads Completion.Code / Error.Text and branches. */
export async function execute(db: Db, caller: Caller, action: ActionDef, params: Param[], now: Date): Promise<Execution> {
  const ref = () => readInput(params, 'RuntimeWorkflow', 'ID');
  try {
    switch (action.key) {
      case 'create': case 'createStart': {
        const r = await createRuntime(db, caller, {
          workCenter: readInput(params, 'WorkCenter', 'Name'), workflow: readInput(params, 'Workflow', 'Name'),
          startingParameters: readStartingParameters(params), start: action.key === 'createStart', now,
        });
        return ok([{ name: 'RuntimeWorkflow', value: group({ ID: r.id, Label: r.label }) }]);
      }
      case 'start': case 'stop': case 'abort': case 'suspend': case 'unsuspend':
        await commandRuntime(db, caller, ref(), action.key);
        return ok([]);
      case 'status': {
        const s = await getRuntimeState(db, caller, ref());
        return ok([{ name: 'Runtime', value: group({ State: s.state }) }]);
      }
      case 'outputs': {
        const o = await getRuntimeOutputs(db, caller, ref());
        return ok([{ name: 'Runtime', value: group({ State: o.state }) }, { name: 'Outputs', value: JSON.stringify(o.outputs) }]);
      }
      case 'wait': {
        const s = await getRuntimeState(db, caller, ref());
        if (s.finished) return ok([{ name: 'Runtime', value: group({ State: s.state }) }]);
        return { state: 'RUNNING', targetInstanceId: s.id };
      }
    }
  } catch (err) {
    if (err instanceof RemoteError) return { state: 'COMPLETED', outputs: [...completionOutputs(err.code, err.message), ...blanks(action)] };
    console.error(`[broker] ${action.name} failed:`, err);
    return { state: 'COMPLETED', outputs: [...completionOutputs(REMOTE_CODES.ERROR, `Internal error: ${err instanceof Error ? err.message : String(err)}`), ...blanks(action)] };
  }
}
