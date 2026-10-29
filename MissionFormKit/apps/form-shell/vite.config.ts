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
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const appRoot = path.dirname(fileURLToPath(import.meta.url))
const tokensFile = path.resolve(appRoot, '../../packages/form-tokens/tokens/form.json')

/**
 * A manifest needs literal hex, and a hand-copied design token is a drift vector — the
 * class this repo has already had to pin twice (BREAKPOINTS to the token source, then
 * layout.css to BREAKPOINTS). Read the real thing instead; manifest.test.ts pins it.
 *
 * `light` is right rather than a compromise: main.tsx imports only the light sheet, so
 * the shell is light-only. A manifest carries one static theme_color and cannot follow
 * prefers-color-scheme, so adopting the dark sheet later needs <meta name="theme-color">.
 */
export const tokenColors = (): { accent: string; surface: string } => {
  const tokens = JSON.parse(readFileSync(tokensFile, 'utf8')) as {
    color: { light: { accent: string; surface: string } }
  }
  return { accent: tokens.color.light.accent, surface: tokens.color.light.surface }
}

const { accent, surface } = tokenColors()

export default defineConfig({
  root: appRoot,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // A service worker in dev serves stale caches and produces the "why isn't my change
      // showing" confusion that costs hours. It exists only in real builds; `npm run
      // preview:shell` is where it gets exercised.
      devOptions: { enabled: false },
      includeAssets: ['icon.svg'],
      manifest: {
        // Says "prototype" on purpose: an installed icon outlives the memory of what it
        // was for, and this is a proving ground, not the product.
        name: 'Mission FormKit Shell (prototype)',
        short_name: 'FormKit Shell',
        description: 'Prototype PWA host for Mission form documents. Not the product.',
        display: 'standalone',
        start_url: '/',
        theme_color: accent,
        background_color: surface,
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        // MockEngine is entirely client-side, so precaching the shell IS full offline
        // function — there is no data layer to cache or sync.
        globPatterns: ['**/*.{js,css,html,svg}'],
      },
    }),
  ],
  optimizeDeps: {
    exclude: ['@mission/form-schema', '@mission/form-tokens', '@mission/form-renderer'],
  },
})
