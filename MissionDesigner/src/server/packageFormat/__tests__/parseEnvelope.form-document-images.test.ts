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
import { describe, expect, it } from 'vitest'
import { parseWorkflowEnvelope } from '../parseEnvelope'

describe('extractRefsAndClean — v2 formDocument image refs', () => {
  it('collects bare-filename refs from image blocks (skips remote/data:/placeholder)', () => {
    const envelope = JSON.stringify({
      schemaVersion: '5.0',
      oid: 'WF1',
      local_id: 'wf',
      version: '1.0.0',
      last_modified_date: '2026-07-23T00:00:00.000Z',
      connections: [],
      steps: [
        {
          local_id: 's1',
          oid: 'S1',
          version: '1.0.0',
          last_modified_date: '2026-07-23T00:00:00.000Z',
          step_type: 'USER_INTERACTION',
          form_document: {
            version: 2,
            sections: [
              {
                id: 'content',
                role: 'content',
                rows: [
                  {
                    id: 'r1',
                    blocks: [
                      { id: 'b1', type: 'image', src: 'photo.png', imageOid: 'OID1', layout: { aspectRatio: '16/9' } },
                      {
                        id: 'b2',
                        type: 'image',
                        src: 'https://cdn.example/x.png',
                        imageOid: 'OID2',
                        layout: { aspectRatio: '16/9' },
                      },
                      {
                        id: 'b3',
                        type: 'image',
                        src: 'No image selected',
                        imageOid: 'OID3',
                        layout: { aspectRatio: '16/9' },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      ],
    })
    const plan = parseWorkflowEnvelope(envelope)
    expect(plan.imageRefs).toEqual([{ specSourceId: 'WF1', filename: 'photo.png' }])
  })

  it('dedupes a converted-legacy step that carries both the v1 and v2 walks over the same filename', () => {
    // A ≤4.0 legacy step (form_layout_config only) is hydrated to v1 formLayouts
    // AND converted to v2 formDocument by importWorkflowSpecToInternal — both
    // shapes reference the same image, so the v1 walk (formLayouts) and the new
    // v2 walk (formDocument) would double-count it without the dedupe guard.
    const envelope = JSON.stringify({
      schemaVersion: '4.0',
      oid: 'WF2',
      local_id: 'wf',
      version: '1.0.0',
      last_modified_date: '2026-07-23T00:00:00.000Z',
      connections: [],
      steps: [
        {
          local_id: 's1',
          oid: 'S1',
          version: '1.0.0',
          last_modified_date: '2026-07-23T00:00:00.000Z',
          step_type: 'USER_INTERACTION',
          form_layout_config: [
            {
              deviceType: 'desktop',
              canvasWidth: 768,
              canvasHeight: 1024,
              elements: [
                {
                  id: 'el-img',
                  type: 'image',
                  src: 'shared.png',
                  imageOid: 'oid-shared',
                  x: 0,
                  y: 0,
                  width: 200,
                  height: 200,
                },
              ],
            },
          ],
        },
      ],
    })
    const plan = parseWorkflowEnvelope(envelope)
    const shared = plan.imageRefs.filter((r) => r.specSourceId === 'WF2' && r.filename === 'shared.png')
    expect(shared).toEqual([{ specSourceId: 'WF2', filename: 'shared.png' }])
  })
})
