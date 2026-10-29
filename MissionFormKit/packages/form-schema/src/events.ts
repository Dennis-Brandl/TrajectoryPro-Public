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

import type { ButtonJob } from './types'

/** Value shapes a form field can hold. Checkbox groups hold string[]. */
export type FormFieldValue = string | string[] | number

/** Host-owned field state, keyed by block fieldName. */
export type FormValues = Record<string, FormFieldValue>

/**
 * The serializable workflow-event vocabulary (spec §6). Plain JSON only —
 * this is also the wire contract between the UI-host and execution apps.
 * `complete` and `decision` originate in UI-host chrome, not the renderer.
 */
export type FormEvent =
  | { kind: 'complete' }
  | { kind: 'decision'; value: string }
  | { kind: 'action'; blockId: string; outputValue: string }
  /** A job button (Continue/Yes/No) was clicked; the host decides what it means. */
  | { kind: 'job'; blockId: string; job: ButtonJob }
  | { kind: 'fieldChange'; fieldName: string; value: FormFieldValue }
  | { kind: 'timerState'; fieldName: string; state: 'running' | 'stopped' | 'elapsed'; elapsedSeconds: number }
  /** The e-signature block's draft changed. Host-owned; never stored in values. */
  | { kind: 'signature'; blockId: string; loginName: string; password: string }
  | { kind: 'validation'; ok: boolean; missing: string[] }
