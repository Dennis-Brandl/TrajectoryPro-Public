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

export default defineConfig({
  // Mirrors vite.config.ts's '@' -> src alias. Like the plugins array above, this is
  // NOT inherited from vite.config.ts (separate config, no merge) — omitting it makes
  // any test that imports through '@/*' (e.g. ui primitives importing '@/lib/utils')
  // fail to resolve under Vitest even though the real Vite dev/build works fine.
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  // Mirrors vite.config.ts's transform so renderer tests see the same JSX runtime
  // (automatic, via react-swc) as the real dev/build. vitest.config.ts is a separate
  // config from vite.config.ts and does NOT inherit its plugins — without this,
  // Vitest falls back to Vite's built-in esbuild transform, which auto-discovers the
  // nearest tsconfig.json (the server config, scoped to src/server and lacking a
  // "jsx" field) and silently defaults to the classic runtime, producing a runtime
  // `ReferenceError: React is not defined` in any .tsx test.
  //
  // @ts-expect-error — vitest@2.1's bundled nested `vite@5` types structurally conflict
  // with the root `vite@7` (pinned per Task 1's brief) that @vitejs/plugin-react-swc's
  // Plugin[] is typed against (two distinct `Plugin`/`PluginOption` interfaces, same
  // shape, different module identity). Purely a tsc-time nominal mismatch — confirmed
  // harmless at runtime (full suite + build green with this plugin wired in). Remove
  // this suppression once vitest is upgraded past its vite-7-compatible major.
  plugins: [react()],
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
    pool: 'forks',
    setupFiles: ['./vitest.setup.ts'],
  },
});
