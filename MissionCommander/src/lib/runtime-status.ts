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
import type { RuntimeWorkflowStatus } from '@/lib/api/types';

const LABELS: Record<RuntimeWorkflowStatus, string> = {
  pending: 'Waiting', queued: 'Starting', running: 'Started',
  pausing: 'Pausing…', resuming: 'Resuming…', stopping: 'Stopping…', aborting: 'Aborting…',
  paused: 'Paused', completed: 'Completed', aborted: 'Aborted',
  errored: 'Errored', stopped: 'Stopped',
};
export function runtimeStatusLabel(status: RuntimeWorkflowStatus): string {
  return LABELS[status] ?? status;
}
export const RUNTIME_DELETABLE: ReadonlySet<RuntimeWorkflowStatus> =
  new Set(['pending', 'completed', 'aborted', 'stopped', 'errored']);

// Mirror of the DAO legal-from sets (mission-control-db/src/dao/runtime-control.ts).
// The server re-checks; these only drive disabled state. Shared by RuntimeDetailDialog
// (per-WC monitoring) and RuntimeWorkflowDetail (Runtime pane).
export const RUNTIME_CAN: Record<'start' | 'pause' | 'resume' | 'stop' | 'abort', ReadonlySet<RuntimeWorkflowStatus>> = {
  start: new Set(['pending']),
  pause: new Set(['running']),
  resume: new Set(['paused']),
  stop: new Set(['running', 'paused', 'pausing']),
  abort: new Set(['queued', 'running', 'pausing', 'paused', 'resuming', 'stopping']),
};
export const RUNTIME_TERMINAL: ReadonlySet<RuntimeWorkflowStatus> = new Set(['completed', 'aborted', 'errored', 'stopped']);
