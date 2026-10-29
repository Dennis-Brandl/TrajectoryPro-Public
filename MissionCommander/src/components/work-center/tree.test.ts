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
import { buildForest } from './tree';
describe('buildForest', () => {
  it('nests children under parents and sorts siblings by name', () => {
    const forest = buildForest([
      { id: 'r', name: 'Root', parentWorkCenterId: null, depth: 0, typeName: null },
      { id: 'b', name: 'Bravo', parentWorkCenterId: 'r', depth: 1, typeName: null },
      { id: 'a', name: 'Alpha', parentWorkCenterId: 'r', depth: 1, typeName: null },
    ]);
    expect(forest).toHaveLength(1);
    expect(forest[0].children.map((c) => c.name)).toEqual(['Alpha', 'Bravo']);
  });
});
