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

/**
 * conventions.ts — Shared constants for all scenarios.
 *
 * Hoisted from warehouse/definition.ts when kitchen/ was added (2026-05-17).
 * Both Warehouse and Kitchen import from here so the status output convention
 * and ISA-88 state lists stay in one place.
 */

import type { ParameterSpec } from './types.js'

export const STATUS_OUTPUT: ParameterSpec = {
  id: 'status',
  value_type: 'literal',
  default_value: '0',
  description: '0=success, 1=simulated abort, 2=simulated timeout',
}

export const OBSERVABLE_STATES = ['STARTING', 'EXECUTING', 'COMPLETING', 'ABORTING']
export const OPAQUE_STATES = ['IN_PROGRESS', 'ABORTING']
