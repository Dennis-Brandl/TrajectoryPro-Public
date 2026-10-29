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

import type { PillVariant } from '../components/Pill'

const SUCCESS_STATES = new Set(['COMPLETED'])
const ERROR_STATES = new Set(['ABORTED', 'ABORTING', 'STOPPING', 'CLEARING'])
const ACCENT_STATES = new Set([
  'EXECUTING',
  'IN_PROGRESS',
  'STARTING',
  'COMPLETING',
  'UNPAUSING',
  'UNHOLDING',
])
const NEUTRAL_STATES = new Set(['PAUSED', 'HELD', 'PAUSING', 'HOLDING', 'POSTED', 'RECEIVED'])

export function pillVariantForState(state: string | undefined | null): PillVariant {
  if (!state) return 'muted'
  if (SUCCESS_STATES.has(state)) return 'success'
  if (ERROR_STATES.has(state)) return 'error'
  if (ACCENT_STATES.has(state)) return 'accent'
  if (NEUTRAL_STATES.has(state)) return 'neutral'
  return 'muted'
}
