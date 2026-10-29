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

import { eq } from 'drizzle-orm';
import { stepInstance, workflowInstance, type BrokerActionInstance } from 'mission-control-db/src/db/schema/index';
import { resolveRuntime, RemoteError, REMOTE_CODES, runtimeStateName } from 'mission-control-db/src/runtime/remote-control/index';
import { completionOutputs, group } from './wire.js';
import { finishInstance, runningWaits, type Db } from './store.js';
import type { EventHub } from './events.js';

const FINAL = new Set(['completed', 'stopped', 'aborted', 'errored']);

/** Spec §6.1. Called on every `engine_wake` notification and on the backstop poll. Idempotent:
 *  finishInstance only moves RUNNING rows, so a wake and a poll may race harmlessly. */
export async function checkWaits(db: Db, hub: EventHub): Promise<number> {
  let finished = 0;
  for (const w of await runningWaits(db)) {
    // One wait's unexpected failure (a dropped connection, a bad row) is logged and skipped —
    // the next wake or poll retries it — so it cannot hold up every other wait in the pass.
    try {
      if (await checkWait(db, hub, w)) finished++;
    } catch (err) {
      console.error(`[broker] wait ${w.id} check failed:`, err);
    }
  }
  return finished;
}

/** Settles one running wait if it can end now; true when this call finished it. */
async function checkWait(db: Db, hub: EventHub, w: BrokerActionInstance): Promise<boolean> {
  const [step] = await db.select({ state: stepInstance.state }).from(stepInstance).where(eq(stepInstance.id, w.stepInstanceId));
  const [callerRow] = await db.select({ status: workflowInstance.status }).from(workflowInstance).where(eq(workflowInstance.id, w.workflowInstanceId));
  const callerStatus = callerRow?.status ?? 'aborted';
  if (!step || step.state !== 'WAITING_ACTION' || callerStatus === 'aborting' || FINAL.has(callerStatus)) {
    // The calling step stopped waiting (abort or timeout already sent ABORT; this also covers
    // a lost ABORT), or the calling runtime is aborting or gone.
    if (!(await finishInstance(db, w.id, 'ABORTED', []))) return false;
    hub.publish(w.id, 'ABORTED', 'RUNNING');
    return true;
  }
  if (callerStatus === 'stopping') {
    // Stop sends nothing to an opaque action and waits for the step to drain,
    // so the wait must complete for the stop to finish.
    const outputs = [...completionOutputs(REMOTE_CODES.WRONG_STATE, 'The calling runtime is stopping'), { name: 'Runtime', value: group({ State: 'Unknown' }) }];
    if (!(await finishInstance(db, w.id, 'COMPLETED', outputs))) return false;
    hub.publish(w.id, 'COMPLETED', 'RUNNING');
    return true;
  }
  let outputs;
  try {
    const t = await resolveRuntime(db, w.targetInstanceId ?? '', '');
    const status = t.live?.status ?? t.finalState;
    if (t.live && !FINAL.has(t.live.status)) return false;
    outputs = [...completionOutputs(REMOTE_CODES.OK, ''), { name: 'Runtime', value: group({ State: runtimeStateName(status) }) }];
  } catch (err) {
    if (!(err instanceof RemoteError)) throw err;
    outputs = [...completionOutputs(err.code, err.message), { name: 'Runtime', value: group({ State: 'Unknown' }) }];
  }
  if (!(await finishInstance(db, w.id, 'COMPLETED', outputs))) return false;
  hub.publish(w.id, 'COMPLETED', 'RUNNING');
  return true;
}
