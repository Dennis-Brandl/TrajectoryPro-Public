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
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const goldenRoot = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: goldenRoot,
  server: { port: 5175, strictPort: true },
  plugins: [react()],
  optimizeDeps: {
    exclude: ['@mission/form-schema', '@mission/form-tokens', '@mission/form-renderer'],
  },
})
