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

import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import noSensitiveTableImports from './eslint-rules/no-sensitive-table-imports.js'

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Plain-JS tooling runs under Node: give `no-undef` the Node globals
    // (console, process, Buffer, fetch, …). TypeScript sources don't need
    // this — typescript-eslint turns `no-undef` off for them.
    files: [
      'scripts/**/*.{js,mjs,cjs}',
      'packages/*/scripts/**/*.{js,mjs,cjs}',
      'eslint-rules/**/*.js',
      'eslint.config.js',
    ],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Defer style decisions to Prettier
      // ignoreRestSiblings: `const { omitMe: _x, ...rest } = obj` is intentional key-omission,
      // not a dead variable — the extracted sibling only exists to drop the key from `rest`.
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', ignoreRestSiblings: true }],
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      cutover: {
        rules: {
          'no-sensitive-table-imports': noSensitiveTableImports,
        },
      },
    },
    rules: {
      'cutover/no-sensitive-table-imports': 'error',
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', 'src/routeTree.gen.ts', '.tanstack/**'],
  },
)
