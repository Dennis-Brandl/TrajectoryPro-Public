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

import { describe, it, expect } from 'vitest';
import fixtures from '../../../mission-control-db/src/lib/runtime-id-fixtures.json';
import { renderRuntimeId, validateRuntimeIdTemplate } from './runtime-id';

// Spec 2026-10-07 §9.3: this renderer keeps a MIRROR of the server formatter because the
// Commander client imports only TYPES from mission-control-db. These assertions are the guard
// that the three existing mirrors in this directory lack — the copy cannot drift silently.
describe('runtime-id mirror parity', () => {
  it('renders every shared fixture identically to the server', () => {
    for (const f of fixtures.render) {
      expect(renderRuntimeId(f.template, {
        now: new Date(f.now), timeZone: f.timeZone, workCenterName: f.workCenterName, seq: f.seq,
      })).toBe(f.expected);
    }
  });
  it('validates every shared fixture identically to the server', () => {
    for (const f of fixtures.validate) {
      expect(validateRuntimeIdTemplate(f.template, { workCenterName: f.workCenterName }).ok).toBe(f.ok);
    }
  });
});
