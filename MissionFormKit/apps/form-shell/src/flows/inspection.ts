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

const s1: FormDocument = {
  version: 2,
  sections: [
    {
      id: 's1-content',
      role: 'content',
      rows: [
        { id: 's1-r1', blocks: [{ id: 's1-h', type: 'header', content: 'Identify the unit' }] },
        {
          id: 's1-r2',
          blocks: [
            {
              id: 's1-serial',
              type: 'textInput',
              fieldName: 'serial',
              label: 'Serial number',
              required: true,
              inputMode: 'text',
            },
          ],
        },
      ],
    },
    {
      id: 's1-footer',
      role: 'footer',
      rows: [
        {
          id: 's1-rf',
          blocks: [
            { id: 's1-continue', type: 'button', label: 'Continue', outputValue: 'continue', emphasis: 'primary' },
          ],
        },
      ],
    },
  ],
}

const s2: FormDocument = {
  version: 2,
  sections: [
    {
      id: 's2-content',
      role: 'content',
      rows: [
        { id: 's2-r1', blocks: [{ id: 's2-h', type: 'header', content: 'Grade the inspection' }] },
        { id: 's2-r2', blocks: [{ id: 's2-t', type: 'text', content: 'Choose the outcome for this unit.', size: 'sm' }] },
      ],
    },
    {
      id: 's2-footer',
      role: 'footer',
      rows: [
        {
          id: 's2-rf',
          gap: 'md',
          blocks: [
            { id: 's2-pass', type: 'button', label: 'Pass', outputValue: 'pass', emphasis: 'primary' },
            { id: 's2-fail', type: 'button', label: 'Fail', outputValue: 'fail', emphasis: 'secondary' },
          ],
        },
      ],
    },
  ],
}

const s3pass: FormDocument = {
  version: 2,
  sections: [
    {
      id: 's3p-content',
      role: 'content',
      rows: [
        { id: 's3p-r1', blocks: [{ id: 's3p-h', type: 'header', content: 'Unit passed' }] },
        { id: 's3p-r2', blocks: [{ id: 's3p-t', type: 'text', content: 'No further action required. Submit to finish.' }] },
      ],
    },
    {
      id: 's3p-footer',
      role: 'footer',
      rows: [
        { id: 's3p-rf', blocks: [{ id: 's3p-finish', type: 'button', label: 'Finish', outputValue: 'finish', emphasis: 'primary' }] },
      ],
    },
  ],
}

const s3fail: FormDocument = {
  version: 2,
  sections: [
    {
      id: 's3f-content',
      role: 'content',
      rows: [
        { id: 's3f-r1', blocks: [{ id: 's3f-h', type: 'header', content: 'Unit failed' }] },
        {
          id: 's3f-r2',
          blocks: [
            { id: 's3f-notes', type: 'textarea', fieldName: 'failureNotes', label: 'Failure notes', required: true, rows: 4 },
          ],
        },
      ],
    },
    {
      id: 's3f-footer',
      role: 'footer',
      rows: [
        { id: 's3f-rf', blocks: [{ id: 's3f-submit', type: 'button', label: 'Submit report', outputValue: 'finish', emphasis: 'primary' }] },
      ],
    },
  ],
}

export const inspectionFlow: FlowGraph = {
  entry: 's1-identify',
  nodes: {
    's1-identify': { screenId: 's1-identify', document: s1, transitions: { continue: 's2-grade' } },
    's2-grade': { screenId: 's2-grade', document: s2, transitions: { pass: 's3-pass', fail: 's3-fail' } },
    's3-pass': { screenId: 's3-pass', document: s3pass, transitions: { finish: COMPLETE } },
    's3-fail': { screenId: 's3-fail', document: s3fail, transitions: { finish: COMPLETE } },
  },
}
