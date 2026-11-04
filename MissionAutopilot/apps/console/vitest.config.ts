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

import { defineProject } from 'vitest/config'
import path from 'path'
import fs from 'fs'

// Radix Dialog (used by the linked UI package) pulls in react-remove-scroll and
// friends, whose CommonJS "main" builds require MissionDesigner's own React.
// Point them at their ES module builds so they share this console's React.
const designerModules = path.resolve(__dirname, '../../../MissionDesigner/node_modules')
const esmAliases = [
  'react-remove-scroll',
  'react-remove-scroll-bar',
  'react-style-singleton',
  'use-sidecar',
  'use-callback-ref',
].flatMap((name) => {
  const pkgDir = path.join(designerModules, name)
  if (!fs.existsSync(pkgDir)) return []
  const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'))
  return pkg.module
    ? [{ find: new RegExp(`^${name}$`), replacement: path.join(pkgDir, pkg.module) }]
    : []
})

export default defineProject({
  // Mirrors vite.config.ts's `define` — this project config is loaded
  // standalone by vitest (not merged with vite.config.ts), so Layout's
  // `__APP_VERSION__` reference needs its own stand-in for tests.
  define: {
    __APP_VERSION__: JSON.stringify('3.0.0'),
  },
  esbuild: { jsx: 'automatic' },
  resolve: {
    // @mission/ui is a file: link into MissionDesigner, which has its own react;
    // tests need one React instance for the shell components to render.
    dedupe: ['react', 'react-dom'],
    alias: [{ find: '@', replacement: path.resolve(__dirname, './src') }, ...esmAliases],
  },
  test: {
    name: 'console',
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // Bundle the linked UI package and its Radix deps so they resolve this
    // console's React rather than MissionDesigner's copy.
    server: {
      deps: {
        inline: [
          /@mission\/ui/,
          /@radix-ui/,
          /MissionDesigner/,
          /react-remove-scroll/,
          /react-style-singleton/,
          /use-sidecar/,
          /use-callback-ref/,
        ],
      },
    },
  },
})
