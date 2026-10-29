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
// Suppress noisy React Flow console warnings that obscure real errors.
// These are benign library internals from @xyflow/react v12.
// Only active in development; production builds tree-shake console calls anyway.

if (import.meta.env.DEV) {
  const originalWarn = console.warn.bind(console)
  const originalError = console.error.bind(console)

  const SUPPRESSED_PATTERNS = ['Please use `getNodesBounds`', 'useSvelteFlow']

  console.warn = (...args: unknown[]) => {
    const msg = typeof args[0] === 'string' ? args[0] : ''
    if (SUPPRESSED_PATTERNS.some((p) => msg.includes(p))) return
    originalWarn(...args)
  }

  // CSS parsing warnings ("Error in parsing value for 'width'") come through console.error
  const SUPPRESSED_ERROR_PATTERNS = ['Error in parsing value for']

  console.error = (...args: unknown[]) => {
    const msg = typeof args[0] === 'string' ? args[0] : ''
    if (SUPPRESSED_ERROR_PATTERNS.some((p) => msg.includes(p))) return
    originalError(...args)
  }
}
