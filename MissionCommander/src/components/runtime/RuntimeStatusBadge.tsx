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
import { runtimeStatusLabel } from '@/lib/runtime-status';
import type { RuntimeWorkflowStatus } from '@/lib/api/types';

// Same tiny uppercase-pill shape as StateBadge (artifact/StateBadge.tsx). Unlike StateBadge —
// which is always muted, keying only on the state text itself — this ALSO keys the tone off
// status, so a glance across a runtime-workflows table picks out `running` and the two error
// terminals from the quieter waiting/completed states.
const TONE: Record<RuntimeWorkflowStatus, string> = {
  pending: 'bg-muted text-muted-foreground',
  queued: 'bg-muted text-muted-foreground',
  running: 'bg-accent text-accent-foreground',
  // Transitional statuses reuse their settled neighbor's tone rather than getting one of
  // their own: pausing/resuming are headed for paused's quiet tone, while stopping/aborting
  // are headed for a forced-terminal outcome and get aborted's attention tone (task-19 brief).
  pausing: 'bg-muted text-muted-foreground',
  resuming: 'bg-muted text-muted-foreground',
  stopping: 'bg-destructive/15 text-destructive',
  aborting: 'bg-destructive/15 text-destructive',
  paused: 'bg-muted text-muted-foreground',
  completed: 'bg-muted text-muted-foreground',
  aborted: 'bg-destructive/15 text-destructive',
  errored: 'bg-destructive/15 text-destructive',
  stopped: 'bg-muted text-muted-foreground',
};

export function RuntimeStatusBadge({ status }: { status: RuntimeWorkflowStatus }) {
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase ${TONE[status]}`}
      title={status}
    >
      {runtimeStatusLabel(status)}
    </span>
  );
}
