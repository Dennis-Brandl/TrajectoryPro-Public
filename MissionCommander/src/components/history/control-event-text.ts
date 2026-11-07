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
import type { ControlEventView } from '@/lib/api/types';

/** Shown when a control event has no usable name (deleted user, empty label): never blank. */
export const UNKNOWN_REQUESTER = 'Unknown requester';
export const requesterName = (name: string | null | undefined): string => (name && name.trim() ? name : UNKNOWN_REQUESTER);

const VERB = { stop: 'Stop', abort: 'Abort' } as const;
const EFFECT = { request: 'requested', escalate: 'escalated', skip_cleanup: 'cleanup skipped' } as const;

/** History dialog line start: "Stop requested", "Abort escalated", "Stop cleanup skipped". */
export function controlEventText(e: Pick<ControlEventView, 'verb' | 'effect'>): string {
  return `${VERB[e.verb]} ${EFFECT[e.effect]}`;
}

/** Record PDF event text: "Stop requested", "Abort requested (escalated)", "Abort cleanup skipped". */
export function controlEventRecordText(e: Pick<ControlEventView, 'verb' | 'effect'>): string {
  if (e.effect === 'skip_cleanup') return `${VERB[e.verb]} cleanup skipped`;
  return `${VERB[e.verb]} requested${e.effect === 'escalate' ? ' (escalated)' : ''}`;
}
