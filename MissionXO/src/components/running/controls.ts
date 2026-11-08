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
import { toast } from 'sonner';
import { ApiError, apiErrorMessage } from '@/lib/api/client';
import type { RuntimeWorkflowLiveDetail } from '@/lib/api/types';
import { RUNTIME_CAN, RUNTIME_DELETABLE, canSkipCleanup } from '@/lib/runtime-status';
import type { WcMode } from '~/lib/access';
import { VIEW_ONLY_TEXT } from '~/lib/view-only';
import { useMeStore } from '~/stores/meStore';

export type Verb = 'start' | 'pause' | 'resume' | 'stop' | 'abort' | 'stopNow' | 'abortNow' | 'delete';

/** Verbs that ask first. Force complete always confirms through its own reason form. */
export const CONFIRM_VERBS: ReadonlySet<Verb> = new Set<Verb>(['stop', 'abort', 'stopNow', 'abortNow', 'delete']);


/** What the Steward may do now. Nothing in view-only mode or while the connection is down. */
export function availableVerbs(detail: RuntimeWorkflowLiveDetail, mode: WcMode, offline: boolean): Record<Verb, boolean> {
  if (mode === 'view-only' || offline) {
    return { start: false, pause: false, resume: false, stop: false, abort: false, stopNow: false, abortNow: false, delete: false };
  }
  const status = detail.summary.status;
  return {
    start: RUNTIME_CAN.start.has(status),
    pause: RUNTIME_CAN.pause.has(status),
    resume: RUNTIME_CAN.resume.has(status),
    stop: RUNTIME_CAN.stop.has(status),
    abort: RUNTIME_CAN.abort.has(status),
    stopNow: canSkipCleanup(status, 'stop', detail.operatorCleanup),
    abortNow: canSkipCleanup(status, 'abort', detail.operatorCleanup),
    delete: RUNTIME_DELETABLE.has(status),
  };
}

/** A control failed. A 403 means the user's rights changed: say so and re-read them, so the
 *  screen re-derives its mode. */
export function reportControlError(err: unknown, fallback: string): void {
  if (err instanceof ApiError && err.status === 403) {
    toast.error(VIEW_ONLY_TEXT);
    void useMeStore.getState().refresh().catch(() => {});
    return;
  }
  toast.error(apiErrorMessage(err, fallback));
}
