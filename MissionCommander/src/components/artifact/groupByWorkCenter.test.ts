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
import { groupByWorkCenter } from './groupByWorkCenter';

const row = (workCenterId: string, workCenterName: string, name: string) =>
  ({ workCenterId, workCenterName, name });

describe('groupByWorkCenter', () => {
  it('groups by work center, ordered by work-center name', () => {
    const groups = groupByWorkCenter([
      row('b', 'Line 2', 'Alpha'),
      row('a', 'Line 1', 'Zeta'),
      row('a', 'Line 1', 'Yankee'),
    ]);
    expect(groups.map((g) => g.workCenterName)).toEqual(['Line 1', 'Line 2']);
    expect(groups[0].items.map((i) => i.name)).toEqual(['Zeta', 'Yankee']);
  });

  it('never re-sorts items within a group', () => {
    // The server already orders by (workCenter.name, name, version, state). Re-sorting here
    // would mask a server-side ordering regression instead of surfacing it.
    const groups = groupByWorkCenter([row('a', 'Line 1', 'Zeta'), row('a', 'Line 1', 'Alpha')]);
    expect(groups[0].items.map((i) => i.name)).toEqual(['Zeta', 'Alpha']);
  });

  it('keeps two work centers holding the same artifact name separate', () => {
    // Same oid loaded into two work centers is two independent entries (spec D3).
    const groups = groupByWorkCenter([row('a', 'Line 1', 'Bottle Fill'), row('b', 'Line 2', 'Bottle Fill')]);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.items).valueOf()).toBe(true);
    expect(groups.map((g) => g.items.length)).toEqual([1, 1]);
  });

  it('returns an empty array for no items', () => {
    expect(groupByWorkCenter([])).toEqual([]);
  });
});
