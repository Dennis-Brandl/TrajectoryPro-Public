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
// form-shell (MissionFormKit) uses neither @testing-library/jest-dom nor
// `test.globals` — it wires @testing-library/react's afterEach cleanup by hand because
// auto-cleanup only registers when a global `afterEach` exists. This project sets
// `globals: true` in vitest.config.ts instead, so vitest's own injected `afterEach`
// global is present before any test file runs and auto-cleanup registers on its own;
// nothing else needs wiring here. No jest-dom import: match form-shell's own tests,
// which use plain assertions (e.g. `toBeTruthy()`), not jest-dom matchers.

import { beforeEach } from 'vitest'

// Form drafts live in sessionStorage (src/task/drafts.ts). jsdom keeps it for the whole
// file, so a draft typed in one test would otherwise seed the next test's form.
beforeEach(() => {
  sessionStorage.clear()
})
