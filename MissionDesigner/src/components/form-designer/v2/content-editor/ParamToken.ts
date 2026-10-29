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
import { Node, mergeAttributes } from '@tiptap/core'

/** Atomic inline chip for a {{ParamName}} reference. The editor's HTML form is
 *  <span data-param-token="Name">{{Name}}</span>; param-tokens.ts converts to/from the
 *  stored plain-text token at the dialog boundary. Atom: deleted as one unit, never
 *  partially editable. */
export const ParamToken = Node.create({
  name: 'paramToken',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return {
      name: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-param-token') ?? '',
        renderHTML: (attrs: { name: string }) => ({ 'data-param-token': attrs.name }),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-param-token]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes({ class: 'tfk-param-chip' }, HTMLAttributes), `{{${node.attrs.name}}}`]
  },
})
