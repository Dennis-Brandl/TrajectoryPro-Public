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
import type { FormDocument } from '@mission/form-schema'
import { COMPLETE, type FlowGraph } from '../engine/MockEngine'

/**
 * A LOOPING flow: the cure step targets itself on "Rework".
 *
 * The other sample flows are acyclic, which is why the step-instance defect went
 * unnoticed — every transition happened to change `screenId`, so the renderer
 * remounted by luck. This flow exercises the case that does not: step -> itself.
 *
 * Each entry is a distinct instance and must start fresh (`docs/HOST-CONTRACT.md`
 * §4), so the cure timer restarts and re-gates on every pass through the loop.
 * 2 seconds rather than a realistic hold so the loop is walkable by hand.
 */
const cure: FormDocument = {
  version: 2,
  sections: [
    {
      id: 'cure-content',
      role: 'content',
      rows: [
        {
          id: 'cure-r1',
          blocks: [
            {
              id: 'cure-h',
              type: 'header',
              content: 'Cure and inspect',
            },
          ],
        },
        {
          id: 'cure-r2',
          blocks: [
            {
              id: 'cure-t',
              type: 'text',
              content:
                'Wait for the cure to complete, then record the reading. If the part fails, rework it and cure again — each cure is a fresh cycle.',
            },
          ],
        },
        {
          id: 'cure-r3',
          blocks: [
            {
              id: 'cure-timer',
              type: 'timer',
              label: 'Cure',
              fieldName: 'cure',
              durationSeconds: 2,
              direction: 'countdown',
              blockDone: true,
            },
            {
              id: 'cure-reading',
              type: 'textInput',
              label: 'Reading',
              fieldName: 'reading',
              required: true,
            },
          ],
        },
      ],
    },
    {
      id: 'cure-footer',
      role: 'footer',
      rows: [
        {
          id: 'cure-r4',
          blocks: [
            { id: 'cure-rework', type: 'button', label: 'Rework', outputValue: 'rework' },
            { id: 'cure-accept', type: 'button', label: 'Accept', outputValue: 'accept' },
          ],
        },
      ],
    },
  ],
}

export const reworkFlow: FlowGraph = {
  entry: 'cure',
  nodes: {
    // `rework` targets this same node — the self-loop the acyclic samples never hit.
    cure: { screenId: 'cure', document: cure, transitions: { rework: 'cure', accept: COMPLETE } },
  },
}
