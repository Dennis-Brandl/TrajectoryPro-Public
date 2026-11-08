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
import '@testing-library/jest-dom/vitest';

// jsdom doesn't implement the Pointer Capture API or scrollIntoView, which Radix UI
// primitives (Select, Dialog, Tabs, etc.) call during interaction. Without these,
// component tests that open a Radix Select/Dialog throw an uncaught
// `target.hasPointerCapture is not a function` (the assertions still pass, but vitest
// reports it as an unhandled error and exits non-zero). No-op under the node
// environment used by server tests, where Element is undefined.
if (typeof Element !== 'undefined') {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  // Unlike the APIs above (which jsdom leaves undefined, so `??=` installs them),
  // jsdom DEFINES window.scrollTo as a stub that throws "Not implemented: window.scrollTo"
  // when called — so `??=` is a no-op and the warning survives. TanStack Router's scroll
  // restoration calls it on every navigation (e.g. index.test.tsx's router mount), so
  // overwrite it outright to keep test output pristine.
  window.scrollTo = () => {};

  // jsdom does not implement matchMedia at all. useTheme() calls it to pick an initial
  // theme when localStorage holds nothing, and it runs in RootLayout — so every test that
  // mounts the router needs this, not just the useTheme test itself. Defaults to "light"
  // (matches: false) so tests are deterministic regardless of the host OS theme.
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
