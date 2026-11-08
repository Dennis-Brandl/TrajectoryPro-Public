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
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import tailwindcss from '@tailwindcss/vite';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default defineConfig({
  base: '/xo/',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    TanStackRouterVite({
      autoCodeSplitting: true,
      generatedRouteTree: './src/routeTree.gen.ts',
      routeFileIgnorePattern: '\\.test\\.(ts|tsx)$',
    }),
    react(),
    tailwindcss(),
    // App shell only: the API is never cached or served from the SW.
    VitePWA({
      registerType: 'prompt',
      scope: '/xo/',
      base: '/xo/',
      devOptions: { enabled: false }, // no SW in dev / e2e
      manifest: {
        id: '/xo/',
        name: 'Mission XO',
        short_name: 'XO',
        start_url: '/xo/',
        scope: '/xo/',
        display: 'standalone',
        background_color: '#000000',
        theme_color: '#000000',
        icons: [
          { src: '/xo/xo-icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/xo/xo-icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/xo/xo-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/xo/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [],
      },
    }),
  ],
  // '@' is Commander's code (shared), '~' is XO's own. Commander files resolve bare imports
  // from MissionCommander/node_modules, so dedupe keeps a single copy of each stateful lib
  // (two Reacts breaks hooks; two @mission/ui copies split Radix's dismissable-layer and
  // focus-scope stacks between XO sheets and Commander dialogs). preserveSymlinks keeps
  // @mission/ui's peers on this app's modules.
  resolve: {
    preserveSymlinks: true,
    dedupe: ['react', 'react-dom', 'react/jsx-runtime', '@mission/ui', '@tanstack/react-router', 'zustand', 'sonner', 'lucide-react', 'better-auth', 'jspdf', 'jspdf-autotable', 'clsx', 'tailwind-merge'],
    alias: { '@': path.resolve(__dirname, '../MissionCommander/src'), '~': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5277,
    proxy: { '/api': { target: `http://localhost:${process.env.API_PORT || '3002'}`, changeOrigin: true } },
  },
});
