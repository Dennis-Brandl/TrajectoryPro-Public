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
import { MockEngine } from '../engine/MockEngine'
import type { FormEngine } from '../engine/FormEngine'
import { inspectionFlow } from './inspection'
import { kitchenSinkFlow } from './kitchenSink'
import { reworkFlow } from './rework'

export interface FlowEntry {
  id: string
  label: string
  createEngine: () => FormEngine
}

export const FLOWS: FlowEntry[] = [
  {
    id: 'inspection',
    label: 'Inspection (branching)',
    createEngine: () => new MockEngine(inspectionFlow),
  },
  {
    id: 'kitchen-sink',
    label: 'Kitchen sink (all blocks)',
    createEngine: () => new MockEngine(kitchenSinkFlow),
  },
  {
    id: 'rework',
    label: 'Rework (self-loop + cure timer)',
    createEngine: () => new MockEngine(reworkFlow),
  },
]

export const DEFAULT_FLOW_ID = FLOWS[0]!.id
