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
import { CancelDialog } from './CancelDialog';

afterEach(cleanup);

describe('CancelDialog', () => {
  it('shows the spec text and needs a reason before it confirms', async () => {
    const onConfirm = vi.fn();
    render(<CancelDialog label="RS-12" name="Line 1" onConfirm={onConfirm} onClose={() => {}} />);
    expect(screen.getByText('This prevents the next start and all chains that have not started. Runs already going continue.')).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'Cancel Runtime Schedule' });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Reason'), '  line is down  ');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith('line is down');
  });
});
