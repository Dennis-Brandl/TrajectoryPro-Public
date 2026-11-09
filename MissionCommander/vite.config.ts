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
import path from 'node:path';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    TanStackRouterVite({
      autoCodeSplitting: true,
      generatedRouteTree: './src/routeTree.gen.ts',
      routeFileIgnorePattern: '\\.test\\.(ts|tsx)$',
    }),
    react(),
    tailwindcss(),
  ],
  // @mission/ui is a file: link into MissionDesigner (which has its own react). Keep the
  // link path so its peer imports resolve from this app's node_modules: one React copy.
  resolve: { preserveSymlinks: true, alias: { '@': path.resolve(__dirname, './src') } },
  // @mission/ui sources sit under node_modules (the kept link path), so Vite does not crawl them and
  // would find their imports (react/jsx-runtime, react-dom, ...) late, serving them unbundled; a fresh
  // checkout then renders "does not provide an export named 'jsx'". Crawl them up front.
  optimizeDeps: { entries: ['index.html', 'node_modules/@mission/ui/src/**/*.{ts,tsx}', '!**/*.test.*'] },
  server: {
    port: 5273,
    proxy: { '/api': { target: `http://localhost:${process.env.API_PORT || '3002'}`, changeOrigin: true } },
  },
});
