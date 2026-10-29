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

/** Completion.Code values (spec 2026-10-15 ruling R8). */
export const REMOTE_CODES = { OK: 0, ERROR: 1, NOT_FOUND: 2, NOT_PERMITTED: 3, WRONG_STATE: 4, INVALID_INPUT: 5 } as const;
export type RemoteCode = (typeof REMOTE_CODES)[keyof typeof REMOTE_CODES];

/** Every refusal from the remote-control operations. `message` is the Error.Text a workflow sees. */
export class RemoteError extends Error {
  constructor(public readonly code: RemoteCode, message: string) {
    super(message);
    this.name = 'RemoteError';
  }
}

/** Runtime.State names (ruling R1): the library's own words, keyed by engine status. */
const STATE_NAMES: Record<string, string> = {
  pending: 'Created', queued: 'Starting', running: 'Running', pausing: 'Suspending', paused: 'Suspended',
  resuming: 'Unsuspending', stopping: 'Stopping', aborting: 'Aborting',
  completed: 'Completed', stopped: 'Stopped', aborted: 'Aborted', errored: 'Errored',
};

export function runtimeStateName(status: string | null | undefined): string {
  return (status && STATE_NAMES[status]) || 'Unknown';
}
