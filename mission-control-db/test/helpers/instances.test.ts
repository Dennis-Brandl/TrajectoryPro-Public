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

import { expect, test } from 'vitest';
import { runtimeCols } from './instances.js';

// Code-review regression (Task 3 fix pass, spec 2026-10-07): runtimeLabel must always agree
// with the row's own runtimeNumber, including when a caller overrides runtimeNumber alone and
// leaves runtimeLabel to be derived. Spreading ...overrides AFTER deriving the label (the
// original bug) silently produced a label that contradicted the overridden number.
test('runtimeCols derives runtimeLabel from the (possibly overridden) runtimeNumber, never the other way around', () => {
  expect(runtimeCols({ runtimeNumber: 12 }).runtimeLabel).toBe('RW-12');
  // An explicit runtimeLabel override still wins outright.
  expect(runtimeCols({ runtimeNumber: 5, runtimeLabel: 'custom' }).runtimeLabel).toBe('custom');
});
