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

// Copies the self-hosted UI fonts (spec §10) from their @fontsource packages into
// public/fonts/<id>/, where Vite serves them in dev and copies them into the build.
// Runs before `dev` and `build` (package.json). public/fonts/ is gitignored: the
// packages are the source of truth. Each font ships its SIL OFL 1.1 licence beside it.
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const FONTS = [
  ['inter', '@fontsource-variable/inter', ['inter-latin-wght-normal.woff2', 'inter-latin-ext-wght-normal.woff2']],
  ['jetbrains-mono', '@fontsource/jetbrains-mono', ['jetbrains-mono-latin-400-normal.woff2', 'jetbrains-mono-latin-ext-400-normal.woff2', 'jetbrains-mono-latin-600-normal.woff2', 'jetbrains-mono-latin-ext-600-normal.woff2']],
  ['ibm-plex-sans', '@fontsource-variable/ibm-plex-sans', ['ibm-plex-sans-latin-wght-normal.woff2', 'ibm-plex-sans-latin-ext-wght-normal.woff2']],
  ['source-sans-3', '@fontsource-variable/source-sans-3', ['source-sans-3-latin-wght-normal.woff2', 'source-sans-3-latin-ext-wght-normal.woff2']],
  ['noto-sans', '@fontsource-variable/noto-sans', ['noto-sans-latin-wght-normal.woff2', 'noto-sans-latin-ext-wght-normal.woff2']],
  ['roboto', '@fontsource-variable/roboto', ['roboto-latin-wght-normal.woff2', 'roboto-latin-ext-wght-normal.woff2']],
  ['open-sans', '@fontsource-variable/open-sans', ['open-sans-latin-wght-normal.woff2', 'open-sans-latin-ext-wght-normal.woff2']],
  ['atkinson-hyperlegible', '@fontsource/atkinson-hyperlegible', ['atkinson-hyperlegible-latin-400-normal.woff2', 'atkinson-hyperlegible-latin-ext-400-normal.woff2', 'atkinson-hyperlegible-latin-700-normal.woff2', 'atkinson-hyperlegible-latin-ext-700-normal.woff2']],
  ['barlow', '@fontsource/barlow', ['barlow-latin-400-normal.woff2', 'barlow-latin-ext-400-normal.woff2', 'barlow-latin-500-normal.woff2', 'barlow-latin-ext-500-normal.woff2', 'barlow-latin-600-normal.woff2', 'barlow-latin-ext-600-normal.woff2']],
  ['fira-sans', '@fontsource/fira-sans', ['fira-sans-latin-400-normal.woff2', 'fira-sans-latin-ext-400-normal.woff2', 'fira-sans-latin-500-normal.woff2', 'fira-sans-latin-ext-500-normal.woff2', 'fira-sans-latin-600-normal.woff2', 'fira-sans-latin-ext-600-normal.woff2']],
  ['lato', '@fontsource/lato', ['lato-latin-400-normal.woff2', 'lato-latin-ext-400-normal.woff2', 'lato-latin-700-normal.woff2', 'lato-latin-ext-700-normal.woff2']],
]

for (const [id, pkg, files] of FONTS) {
  const from = join(root, 'node_modules', pkg)
  const to = join(root, 'public', 'fonts', id)
  mkdirSync(to, { recursive: true })
  for (const file of files) copyFileSync(join(from, 'files', file), join(to, file))
  copyFileSync(join(from, 'LICENSE'), join(to, 'LICENSE'))
}
