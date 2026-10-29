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
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import path from 'node:path'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

// https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    TanStackRouterVite({
      autoCodeSplitting: true,
      // Reduce file watching aggressiveness on Windows
      generatedRouteTree: './src/routeTree.gen.ts',
    }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    // The @mission/form-* packages are `file:` deps on the sibling MissionFormKit
    // checkout, so npm symlinks them. Vite resolves through symlinks to the real path, and
    // module resolution from THERE walks up into MissionFormKit/node_modules — which has
    // its own React (19.2.7 vs ours). Two React copies means every hook in the renderer
    // throws "Invalid hook call". form-renderer peers on react ^19 precisely so it uses the
    // host's copy; this is what makes that true.
    dedupe: ['react', 'react-dom'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-flow': ['@xyflow/react'],
          codemirror: ['@uiw/react-codemirror', '@codemirror/lang-javascript'],
          pdf: ['jspdf', 'jspdf-autotable'],
          zip: ['jszip'],
          tiptap: ['@tiptap/react', '@tiptap/starter-kit'],
        },
      },
    },
  },
  optimizeDeps: {
    include: ['dagre'],
    // The @mission/form-* packages ship TypeScript source (exports → ./src/*.ts), not a
    // built dist, so they must go through this app's pipeline rather than be pre-bundled as
    // opaque deps. FormKit's own demo/shell/golden configs exclude them the same way.
    exclude: ['@mission/form-schema', '@mission/form-tokens', '@mission/form-renderer'],
  },
  server: {
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.API_PORT || process.env.PORT || '3001'}`,
        changeOrigin: true,
      },
    },
    // When running inside Docker with a bind-mounted volume (especially from
    // a Windows host), native filesystem events may not propagate.  Fall back
    // to polling so Vite picks up file changes reliably.
    watch: {
      usePolling: !!process.env.DOCKER_DEV,
      interval: 1000,
    },
  },
})
