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

import type { InboxTask } from './api/types'

// The one "which task is this" string: step name (else its oid) and the runtime ID.
// Tabs, toasts and the browser tab title all use it, so an operator matching a
// toast to a tab sees exactly the same text.
export function taskLabel(t: Pick<InboxTask, 'stepName' | 'stepOid' | 'runtimeLabel'>): string {
  return `${t.stepName ?? t.stepOid} · ${t.runtimeLabel}`
}
