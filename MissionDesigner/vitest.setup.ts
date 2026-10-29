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

import 'fake-indexeddb/auto'

// Vite injects `process.env.BASE_URL = "/"` in the test runtime, which trips
// better-auth's URL validator during module init. Override with a valid URL
// before any test file imports auth.
if (!process.env.BASE_URL || process.env.BASE_URL === '/') {
  process.env.BASE_URL = 'http://localhost:3000'
}

// PGlite loads its WASM module by calling .arrayBuffer() on a Blob.
// jsdom replaces the native Node.js Blob with its own implementation which
// omits this method. Polyfill it via FileReader (also provided by jsdom) so
// jsdom-environment tests that import PGlite (contract.live, rate-limit) work.
if (typeof Blob !== 'undefined' && !Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function (): Promise<ArrayBuffer> {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as ArrayBuffer)
      reader.onerror = () => reject(reader.error)
      reader.readAsArrayBuffer(this)
    })
  }
}
process.env.BETTER_AUTH_SECRET ||= 'test-secret-not-for-production'

// jsdom doesn't implement the Pointer Capture API or scrollIntoView, which the
// Radix UI primitives (Select, etc.) call during interaction. Without these,
// component tests that open a Radix Select throw an uncaught
// `target.hasPointerCapture is not a function` (the assertions still pass, but
// vitest reports it as an unhandled error and exits non-zero). No-op under the
// node environment used by server tests, where Element is undefined.
if (typeof Element !== 'undefined') {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => {}
  Element.prototype.releasePointerCapture ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
}

// jsdom has no ResizeObserver and no CSSOM CSS.escape; the v2 form-designer overlay + rect-map
// use both. Minimal stubs so their component/hook tests can mount (extraction of the copies that
// were inline in SelectionOverlay.test — the P3.2-deferred dedup).
;(globalThis as { CSS?: { escape(v: string): string } }).CSS ??= {
  escape: (v: string) => v.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`),
}
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}
