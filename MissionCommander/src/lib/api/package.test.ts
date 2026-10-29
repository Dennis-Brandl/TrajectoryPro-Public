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
import { packages } from './package';

describe('packages.downloadUrl', () => {
  it('carries the scope', () => {
    expect(packages.downloadUrl('wc-1', 'effective'))
      .toBe('/api/work-centers/wc-1/package?scope=effective');
  });

  // The download is a plain navigation, not a fetch — the id goes into a URL the browser
  // follows, so it must be encoded rather than interpolated raw.
  it('encodes the work center id', () => {
    expect(packages.downloadUrl('a/b', 'all'))
      .toBe('/api/work-centers/a%2Fb/package?scope=all');
  });
});
