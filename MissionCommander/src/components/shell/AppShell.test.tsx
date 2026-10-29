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
import { AppShell } from './AppShell';

// This config does not enable Vitest globals, so @testing-library/react cannot
// auto-register its afterEach(cleanup). Without this, each render() leaks its DOM
// into document.body and later getByRole calls match duplicates.
afterEach(cleanup);

describe('AppShell', () => {
  it('renders the activity rail with all five hierarchies enabled', () => {
    render(<AppShell />);
    expect(screen.getByRole('button', { name: /work centers/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /users/i })).toBeEnabled();
    // Workflows was disabled ("coming later") until M3 turned it on.
    expect(screen.getByRole('button', { name: /workflows/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /environments/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /roles/i })).toBeEnabled();
    // M6 retired Libraries: a work center already IS the execution set.
    expect(screen.queryByRole('button', { name: /libraries/i })).toBeNull();
  });
});
