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
// Same drift-proofing as form-shell: manifest colors come from the token source file.
const tokensFile = path.resolve(appRoot, '../MissionFormKit/packages/form-tokens/tokens/form.json')
export const tokenColors = (): { accent: string; surface: string } => {
  const tokens = JSON.parse(readFileSync(tokensFile, 'utf8')) as { color: { light: { accent: string; surface: string } } }
  return { accent: tokens.color.light.accent, surface: tokens.color.light.surface }
}
const { accent, surface } = tokenColors()

export default defineConfig({
  root: appRoot,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: { enabled: false }, // same rationale as form-shell: no SW in dev
      // ic_launcher_round.png is the tab favicon shared with Mission Designer and Mission
      // Autopilot (48px PNG, too small for the manifest icons, which stay the SVGs below).
      includeAssets: ['icon.svg', 'ic_launcher_round.png'],
      manifest: {
        name: 'Mission Pilot',
        short_name: 'Pilot',
        description: 'Operator task inbox for the Trajectory Pro Mission Control suite.',
        display: 'standalone',
        start_url: '/',
        theme_color: accent,
        background_color: surface,
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      // Precache the app shell only. The inbox is NOT cached by the SW — offline shows
      // the localStorage snapshot with the read-only banner (spec D6, Task 5).
      // woff2: only the default faces are precached (spec §10 Inter + JetBrains Mono); the
      // other curated theme fonts and brand logos cache on first use (spec §13 item 4) —
      // precaching all eleven families would add ~1 MB to every install.
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg}', 'fonts/inter/*.woff2', 'fonts/jetbrains-mono/*.woff2'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/fonts/'),
            handler: 'CacheFirst',
            options: { cacheName: 'pilot-fonts', expiration: { maxEntries: 80 } },
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/brand/'),
            handler: 'CacheFirst',
            options: { cacheName: 'pilot-brand', expiration: { maxEntries: 20 } },
          },
        ],
      },
    }),
  ],
  optimizeDeps: {
    exclude: ['@mission/form-schema', '@mission/form-tokens', '@mission/form-renderer'],
  },
  server: {
    port: 5275,
    strictPort: true,
    // Dev-only: the real deployment is same-origin (engine serves the bundle).
    proxy: { '/api': { target: 'http://127.0.0.1:3006', changeOrigin: false } },
  },
  build: {
    // The engine serves ./public relative to its own CWD in dev/e2e (src/index.ts
    // serveStatic root './public'); building straight into it means `npm run build`
    // is the whole deploy for dev and the e2e webServer. Docker builds its own copy
    // (engine Dockerfile, Task 10). The dir is gitignored on the engine side.
    outDir: path.resolve(appRoot, '../MissionEngine/public'),
    emptyOutDir: true,
  },
})
