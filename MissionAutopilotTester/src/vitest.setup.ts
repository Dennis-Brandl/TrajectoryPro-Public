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

import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach } from 'vitest'
import { installMockEventSource, restoreEventSource } from './lib/test-event-source'

// Install MockEventSource globally for all tests. To opt out in a specific describe
// block, call restoreEventSource() in beforeEach and installMockEventSource() in
// afterEach — see test-event-source.test.ts install/restore suite.
installMockEventSource()
afterEach(() => {
  restoreEventSource()
  installMockEventSource()
})

// Skip the welcome splash by default in every test so suites that render <App />
// see the main shell. The splash itself is exercised in its own test file by
// clearing this key first.
beforeEach(() => {
  localStorage.setItem('mission-tester-splash-dismissed', 'true')
})
