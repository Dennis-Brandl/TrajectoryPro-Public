// @vitest-environment jsdom
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
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { NameWithType } from './NameWithType';

afterEach(cleanup);

describe('NameWithType', () => {
  it('appends the type after a separator', () => {
    const { container } = render(<div><NameWithType name="Line 1" typeName="Production Line" /></div>);
    expect(container.textContent).toBe('Line 1 · Production Line');
  });
  it('renders just the name when there is no type', () => {
    for (const t of [null, undefined, '']) {
      const { container, unmount } = render(<div><NameWithType name="Line 1" typeName={t} /></div>);
      expect(container.textContent).toBe('Line 1');
      expect(container.textContent).not.toContain('·');
      unmount();
    }
  });
});
