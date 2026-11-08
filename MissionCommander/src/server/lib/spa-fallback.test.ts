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
import { describe, expect, it } from 'vitest';
import { spaFallbackFile, xoRedirect } from './spa-fallback';

describe('spaFallbackFile', () => {
  it('routes paths to the right fallback', () => {
    expect(spaFallbackFile('/api/foo')).toBe('api-404');
    expect(spaFallbackFile('/xo/')).toBe('xo');
    expect(spaFallbackFile('/xo/wc/abc/history/def')).toBe('xo');
    expect(spaFallbackFile('/xox')).toBe('commander');
    expect(spaFallbackFile('/work-centers')).toBe('commander');
  });
  it('redirects only the bare /xo', () => {
    expect(xoRedirect('/xo')).toBe('/xo/');
    expect(xoRedirect('/xo/')).toBeNull();
  });
});
