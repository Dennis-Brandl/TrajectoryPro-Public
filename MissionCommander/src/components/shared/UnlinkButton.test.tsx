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

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UnlinkButton } from './UnlinkButton';

afterEach(cleanup);

describe('UnlinkButton', () => {
  it('calls onClick and disables while busy', async () => {
    const onClick = vi.fn(async () => {});
    render(<UnlinkButton label="Unlink X" onClick={onClick} disabled={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Unlink X' }));
    expect(onClick).toHaveBeenCalledOnce();
  });
  it('is disabled and titled when disabled', () => {
    render(<UnlinkButton label="Unlink X" onClick={() => {}} disabled />);
    const btn = screen.getByRole('button', { name: 'Unlink X' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', 'Requires work_center:link');
  });
});
