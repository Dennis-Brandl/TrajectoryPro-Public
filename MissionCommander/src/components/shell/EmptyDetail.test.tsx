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
import { EmptyDetail } from './EmptyDetail';

afterEach(cleanup);

describe('EmptyDetail', () => {
  it('shows the welcome card with the picture and the message', () => {
    render(<EmptyDetail message="Select a user" />);
    expect(screen.getByRole('heading', { name: 'Welcome to Mission Commander' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /work center/i })).toHaveAttribute('src', '/MissionCommanderStartGraphic.png');
    expect(screen.getByText('Select a user')).toBeInTheDocument();
  });

  it('sits the picture on white in either theme, like Designer', () => {
    render(<EmptyDetail message="x" />);
    expect(screen.getByRole('img', { name: /work center/i }).className).toContain('bg-white');
  });
});
