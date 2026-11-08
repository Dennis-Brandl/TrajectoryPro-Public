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

// vitest.config.ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react-swc';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default defineConfig({
  // Mirrors vite.config.ts (separate config, no merge): the same aliases and dedupe, so
  // tests importing Commander code through '@' render with this app's single React.
  resolve: {
    preserveSymlinks: true,
    dedupe: ['react', 'react-dom', 'react/jsx-runtime', '@mission/ui', '@tanstack/react-router', 'zustand', 'sonner', 'lucide-react', 'better-auth', 'jspdf', 'jspdf-autotable', 'clsx', 'tailwind-merge'],
    alias: { 'virtual:pwa-register/react': path.resolve(__dirname, './src/test/pwa-register-react-stub.ts'), '@': path.resolve(__dirname, '../MissionCommander/src'), '~': path.resolve(__dirname, './src') },
  },
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // Same JSX runtime (automatic, via react-swc) as the real build.
  //
  // @ts-expect-error — vitest@2.1's bundled nested `vite@5` types structurally conflict
  // with the root `vite@7` that @vitejs/plugin-react-swc's Plugin[] is typed against.
  // Purely a tsc-time nominal mismatch, harmless at runtime (same as MissionCommander).
  plugins: [react()],
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
    pool: 'forks',
    setupFiles: ['./vitest.setup.ts'],
  },
});
