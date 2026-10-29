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

import type { DiagramConnection, DiagramSpec, PilotLiveStep } from '../../api/types'

const link = (fromStepOid: string, toStepOid: string): DiagramConnection => ({
  fromStepOid,
  toStepOid,
  condition: null,
  waypoints: null,
  sourceHandleId: null,
})

const step = (oid: string, name: string, stepType: string, x: number, y: number) => ({ oid, name, stepType, x, y, childSpecOid: null })

// START → Weigh → Charge → Heat → END, plus "Side note" that no connection reaches, listed
// out of order on purpose, and one sub-workflow holding "Inner".
export const ROOT: DiagramSpec = {
  oid: 'root',
  name: 'Batch Mix',
  version: '3',
  state: null,
  notation: 'flowchart',
  steps: [
    step('start', 'Start', 'START', 0, 0),
    step('heat', 'Heat', 'USER_INTERACTION', 0, 300),
    step('weigh', 'Weigh', 'USER_INTERACTION', 0, 100),
    step('charge', 'Charge', 'USER_INTERACTION', 0, 200),
    step('note', 'Side note', 'USER_INTERACTION', 400, 50),
    step('end', 'End', 'END', 0, 400),
  ],
  connections: [link('start', 'weigh'), link('weigh', 'charge'), link('charge', 'heat'), link('heat', 'end')],
  children: [
    {
      oid: 'child',
      name: 'Sub',
      version: null,
      state: null,
      notation: 'flowchart',
      steps: [step('c1', 'Inner', 'USER_INTERACTION', 0, 0)],
      connections: [],
      children: [],
    },
  ],
}

export const liveStep = (state: string): PilotLiveStep => ({ state, nodeOid: 'n', error: null, assignment: null })
