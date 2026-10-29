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
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// @testing-library/react's own auto-cleanup only registers when the global
// `afterEach` exists (see its dist/index.js). This project imports test
// hooks explicitly from 'vitest' rather than enabling `test.globals`, so that
// auto-registration silently never fires and rendered trees (and their
// effects/timers) leak across tests. Wire cleanup explicitly instead.
afterEach(() => {
  cleanup()
})
