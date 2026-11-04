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
import { StateBadge } from './StateBadge';

afterEach(cleanup);

describe('StateBadge', () => {
  it('renders a StateTag with the suite tag shape and tone', () => {
    render(<StateBadge state="Effective" effectiveFrom={null} />);
    const tag = screen.getByText('Effective');
    expect(tag.className).toContain('text-[11px]');
    expect(tag.className).toContain('bg-status-ok-bg');
  });
  it('keeps the effective-from hover title and right-hand placement', () => {
    render(<StateBadge state="Draft" effectiveFrom="2026-01-02T00:00:00Z" />);
    const tag = screen.getByText('Draft');
    expect(tag.getAttribute('title')).toMatch(/^Effective from /);
    expect(tag.parentElement?.className).toContain('ml-auto');
    expect(tag.parentElement?.className).toContain('shrink-0');
  });
});
