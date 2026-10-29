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
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dialog, DialogTrigger, DialogContent, DialogTitle } from './dialog';

describe('Dialog', () => {
  it('opens on trigger click', async () => {
    render(<Dialog><DialogTrigger>Open</DialogTrigger><DialogContent><DialogTitle>Hi</DialogTitle></DialogContent></Dialog>);
    expect(screen.queryByText('Hi')).not.toBeInTheDocument();
    await userEvent.click(screen.getByText('Open'));
    expect(await screen.findByText('Hi')).toBeInTheDocument();
  });
});
