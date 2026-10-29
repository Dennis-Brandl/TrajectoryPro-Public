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

/// <reference types="vite/client" />

declare const __APP_VERSION__: string

/**
 * `vite/client` types bare `*.css` imports, but not stylesheets reached through a package's
 * `exports` map — TS resolves the subpath against the package's types and finds none, so
 * `@mission/form-tokens/css/light` is an error without this. Vite handles them fine at
 * build time; this only teaches tsc they exist.
 *
 * A host must import all three (see MissionFormKit `docs/HOST-CONTRACT.md` §6). Note the
 * tokens sheet is a BUILD OUTPUT — absent until FormKit's `build:tokens` runs, which this
 * app's dev/build scripts now invoke.
 */
declare module '@mission/form-tokens/css/light'
declare module '@mission/form-tokens/css/dark'
declare module '@mission/form-renderer/layout.css'
declare module '@mission/form-renderer/controls.css'
