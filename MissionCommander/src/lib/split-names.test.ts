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
import { splitNames } from './split-names';

describe('splitNames', () => {
  it('returns one trimmed name', () => expect(splitNames('  Line 1 ')).toEqual(['Line 1']));
  it('splits a comma-separated list, trimming each name', () =>
    expect(splitNames('Time Sheet Approver, Entry Clerk,Line 2 Operator ,  Warehouse Supervisor'))
      .toEqual(['Time Sheet Approver', 'Entry Clerk', 'Line 2 Operator', 'Warehouse Supervisor']));
  it('drops empty pieces', () => expect(splitNames(', A,, ,B,')).toEqual(['A', 'B']));
  it('keeps the first of names that match ignoring case', () => expect(splitNames('Line 1, line 1, LINE 1')).toEqual(['Line 1']));
  it('returns nothing for blank input', () => expect(splitNames('   ')).toEqual([]));
});
