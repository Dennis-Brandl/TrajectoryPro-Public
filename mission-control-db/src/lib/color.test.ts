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
import { HEX_RE, contrast, mixOklab, oklch, hueDistance } from './color';

describe('colour math (spec 2026-10-09 §11)', () => {
  it('HEX_RE accepts #rrggbb only', () => {
    expect(HEX_RE.test('#1d4ed8')).toBe(true);
    expect(HEX_RE.test('#1D4ED8')).toBe(true);
    for (const bad of ['#fff', '1d4ed8', '#1d4ed8ff', 'red', '#1d4ed8;', ' #1d4ed8']) expect(HEX_RE.test(bad)).toBe(false);
  });

  it('contrast follows WCAG 2.x', () => {
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#1d4ed8', '#ffffff').toFixed(2)).toBe('6.70'); // spec §6.2's default accent
    expect(contrast('#777777', '#777777')).toBeCloseTo(1, 5);
  });

  it('mixOklab: p=1 is the first colour, p=0 the second, equal endpoints are unchanged', () => {
    expect(mixOklab('#1d4ed8', '#ffffff', 1)).toBe('#1d4ed8');
    expect(mixOklab('#1d4ed8', '#ffffff', 0)).toBe('#ffffff');
    expect(mixOklab('#4b5563', '#4b5563', 0.37)).toBe('#4b5563');
  });

  it('oklch: hue in degrees [0, 360), near-zero chroma for greys', () => {
    const red = oklch('#ff0000');
    expect(red.h).toBeCloseTo(29.2, 0);
    expect(red.c).toBeGreaterThan(0.2);
    expect(oklch('#808080').c).toBeLessThan(0.001);
    for (const hex of ['#00ff00', '#0000ff', '#ff00ff', '#00ffff']) {
      const { h } = oklch(hex);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    }
  });

  it('hueDistance is the shorter way round the circle', () => {
    expect(hueDistance(350, 10)).toBe(20);
    expect(hueDistance(10, 350)).toBe(20);
    expect(hueDistance(90, 270)).toBe(180);
    expect(hueDistance(45, 45)).toBe(0);
  });
});
