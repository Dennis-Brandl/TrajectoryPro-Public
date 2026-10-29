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
import { paletteFor } from './colors';

describe('paletteFor', () => {
  it('colors START green', () => {
    expect(paletteFor('START')).toEqual({ stroke: '#22c55e', fill: '#dcfce7' });
  });

  it('colors END red', () => {
    expect(paletteFor('END')).toEqual({ stroke: '#ef4444', fill: '#fee2e2' });
  });

  it('colors a gateway type amber', () => {
    expect(paletteFor('SELECT 1')).toEqual({ stroke: '#f59e0b', fill: '#fef3c7' });
  });

  it('colors GATE the same amber as the other gateway types', () => {
    expect(paletteFor('GATE')).toEqual({ stroke: '#f59e0b', fill: '#fef3c7' });
  });

  it('colors SCRIPT with the amber stroke but a white fill, matching Designer\'s ScriptStepNode', () => {
    // Designer's ScriptStepNode.tsx always fills white — SCRIPT_AMBER is only the '<>' icon
    // color, never the shape fill (confirmed against
    // pdf-canvas-minimap.ts::getNodeStyle: case 'scriptStep' -> { fill: '#ffffff', stroke: SCRIPT_AMBER }).
    expect(paletteFor('SCRIPT')).toEqual({ stroke: '#d97706', fill: '#ffffff' });
  });

  it('falls through to the default slate/white palette for an unknown step type', () => {
    expect(paletteFor('TELEPORT')).toEqual({ stroke: '#64748b', fill: '#ffffff' });
  });
});
