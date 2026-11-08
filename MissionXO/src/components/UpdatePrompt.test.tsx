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
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

const state = { needRefresh: true, updateServiceWorker: vi.fn() };
vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [state.needRefresh, vi.fn()],
    offlineReady: [false, vi.fn()],
    updateServiceWorker: state.updateServiceWorker,
  }),
}));

import { UpdatePrompt } from './UpdatePrompt';

afterEach(() => { cleanup(); state.updateServiceWorker.mockClear(); });

describe('UpdatePrompt', () => {
  it('shows the bar and Reload applies the update', () => {
    state.needRefresh = true;
    render(<UpdatePrompt />);
    expect(screen.getByText(/A new version is available/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(state.updateServiceWorker).toHaveBeenCalledWith(true);
  });

  it('renders nothing when no update is waiting', () => {
    state.needRefresh = false;
    const { container } = render(<UpdatePrompt />);
    expect(container).toBeEmptyDOMElement();
  });
});
