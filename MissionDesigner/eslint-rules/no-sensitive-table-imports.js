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

// Phase 35 cutover (§2.3 read-DAO requirement):
// Block imports of `_sensitiveTables` and `_rawSchema` from outside the DAO layer.
// The DAO layer is `src/server/dao/**` and the schema files themselves
// (which legitimately re-export their own internals).

const ALLOWED_IMPORTERS = [
  /[\\/]src[\\/]server[\\/]dao[\\/]/,
  /[\\/]src[\\/]server[\\/]db[\\/]_sensitiveTables\.ts$/,
  /[\\/]src[\\/]server[\\/]db[\\/]_rawSchema\.ts$/,
  /[\\/]src[\\/]server[\\/]db[\\/]__tests__[\\/]/, // tests may inspect
]

const FORBIDDEN_PATHS = [/[\\/]_sensitiveTables(\.ts)?$/, /[\\/]_rawSchema(\.ts)?$/]

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow imports of _sensitiveTables or _rawSchema from non-DAO files',
    },
    schema: [],
    messages: {
      forbidden:
        '_sensitiveTables and _rawSchema are private to the DAO layer (§2.3). ' +
        'Move this query into src/server/dao/ or import the public table object from schema.ts directly.',
    },
  },
  create(context) {
    const filename = context.filename || context.getFilename()
    const isAllowed = ALLOWED_IMPORTERS.some((re) => re.test(filename))
    if (isAllowed) return {}

    function checkSource(node, source) {
      if (typeof source !== 'string') return
      if (FORBIDDEN_PATHS.some((re) => re.test(source))) {
        context.report({ node, messageId: 'forbidden' })
      }
    }

    return {
      ImportDeclaration(node) {
        checkSource(node, node.source.value)
      },
      ImportExpression(node) {
        if (node.source.type === 'Literal') {
          checkSource(node, node.source.value)
        }
      },
    }
  },
}
