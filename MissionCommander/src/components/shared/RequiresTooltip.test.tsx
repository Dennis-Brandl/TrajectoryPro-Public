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
import { render, screen, cleanup } from '@testing-library/react';
import { RequiresTooltip } from './RequiresTooltip';

afterEach(cleanup);
describe('RequiresTooltip', () => {
  it('carries the reason as a hover title on the wrapper when disabled', () => {
    render(<RequiresTooltip reason="Requires workflow:create"><button disabled>Import</button></RequiresTooltip>);
    // the wrapper span carries the title (the disabled button can't show its own tooltip)
    expect(screen.getByRole('button', { name: 'Import' }).parentElement).toHaveAttribute('title', 'Requires workflow:create');
  });
  it('carries no title when not gated', () => {
    render(<RequiresTooltip reason={undefined}><button>Import</button></RequiresTooltip>);
    expect(screen.getByRole('button', { name: 'Import' }).parentElement).not.toHaveAttribute('title');
  });
});
