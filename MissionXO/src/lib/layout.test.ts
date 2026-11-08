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
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { layoutFor, useLayout } from './layout';

function mockMq(width: { v: number }) {
  const listeners = new Set<() => void>();
  window.matchMedia = vi.fn((q: string) => {
    const min = Number(/min-width:\s*(\d+)px/.exec(q)?.[1]);
    return {
      get matches() { return width.v >= min; },
      media: q,
      addEventListener: (_: string, l: () => void) => listeners.add(l),
      removeEventListener: (_: string, l: () => void) => listeners.delete(l),
    };
  }) as unknown as typeof window.matchMedia;
  return listeners;
}

describe('layout', () => {
  afterEach(() => vi.restoreAllMocks());
  it('maps widths to layouts', () => {
    expect([layoutFor(1280), layoutFor(1279), layoutFor(768), layoutFor(767)]).toEqual(['desktop', 'tablet', 'tablet', 'phone']);
  });
  it('useLayout follows media query changes and unsubscribes', () => {
    const width = { v: 1400 };
    const listeners = mockMq(width);
    const { result, unmount } = renderHook(() => useLayout());
    expect(result.current).toBe('desktop');
    act(() => { width.v = 800; listeners.forEach((l) => l()); });
    expect(result.current).toBe('tablet');
    act(() => { width.v = 500; listeners.forEach((l) => l()); });
    expect(result.current).toBe('phone');
    unmount();
    expect(listeners.size).toBe(0);
  });
});
