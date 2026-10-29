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
import type { FormDocument } from '../types'

/**
 * Canonical fixture: every block variant, valid against the JSON Schema.
 * Consumed by form-schema and form-renderer tests; seed for the P1 golden
 * fixture suite.
 */
export const kitchenSinkDocument: FormDocument = {
  version: 2,
  sections: [
    {
      id: 'ks-content',
      role: 'content',
      rows: [
        {
          id: 'ks-r1',
          blocks: [
            { id: 'ks-header', type: 'header', content: 'Kitchen sink' },
            { id: 'ks-text', type: 'text', content: 'Every block variant once.', size: 'sm' },
          ],
        },
        {
          id: 'ks-r2',
          gap: 'lg',
          blocks: [
            {
              id: 'ks-input',
              type: 'textInput',
              fieldName: 'serial',
              label: 'Serial',
              required: true,
              inputMode: 'text',
              layout: { span: { base: 6, phone: 12 } },
            },
            {
              id: 'ks-textarea',
              type: 'textarea',
              fieldName: 'notes',
              label: 'Notes',
              rows: 4,
              layout: { span: { base: 6, phone: 12 } },
            },
          ],
        },
        {
          id: 'ks-r3',
          blocks: [
            {
              id: 'ks-checkbox',
              type: 'checkbox',
              fieldName: 'checks',
              // Labelled and required so the goldens pin the group's <legend> — a legend
              // is not a flex item, so its rendering inside .tfk-fieldset is exactly the
              // kind of thing a pixel baseline should be watching.
              label: 'Parts checked',
              required: true,
              options: [
                { label: 'Seals', value: 'seals' },
                { label: 'Bolts', value: 'bolts' },
              ],
              layout: { span: { base: 6 } },
            },
            {
              id: 'ks-radio',
              type: 'radio',
              fieldName: 'grade',
              label: 'Grade',
              options: [
                { label: 'Pass', value: 'pass' },
                { label: 'Fail', value: 'fail' },
              ],
              layout: { span: { base: 6 } },
            },
          ],
        },
        {
          id: 'ks-r4',
          blocks: [
            {
              id: 'ks-image',
              type: 'image',
              src: 'pump.jpg',
              objectFit: 'cover',
              layout: { span: { base: 6 }, aspectRatio: '4/3' },
            },
            {
              id: 'ks-video',
              type: 'video',
              src: 'https://example.com/clip.mp4',
              layout: { span: { base: 6 }, aspectRatio: '16/9' },
            },
          ],
        },
        {
          id: 'ks-r5',
          blocks: [
            { id: 'ks-divider', type: 'divider', weight: 'hairline' },
            {
              id: 'ks-timer',
              type: 'timer',
              label: 'Cure time',
              fieldName: 'cure',
              durationSeconds: 300,
              direction: 'countdown',
            },
          ],
        },
        {
          id: 'ks-r6',
          blocks: [
            {
              id: 'ks-esig',
              type: 'esignature',
              fieldName: 'approval',
              label: 'Approve inspection',
              meaning: 'I confirm the inspection results above are complete and accurate.',
              roleName: 'Supervisor',
            },
          ],
        },
      ],
    },
    {
      id: 'ks-footer',
      role: 'footer',
      rows: [
        {
          id: 'ks-r9',
          blocks: [
            { id: 'ks-button', type: 'button', label: 'Retry scan', outputValue: 'retry', emphasis: 'secondary' },
          ],
        },
      ],
    },
  ],
}
