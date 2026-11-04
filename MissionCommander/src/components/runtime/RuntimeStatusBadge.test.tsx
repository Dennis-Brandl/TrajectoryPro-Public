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
import { RuntimeStatusBadge } from './RuntimeStatusBadge';

afterEach(cleanup);

const cls = (status: Parameters<typeof RuntimeStatusBadge>[0]['status'], label: string) => {
  render(<RuntimeStatusBadge status={status} />);
  return screen.getByText(label).className;
};

describe('RuntimeStatusBadge', () => {
  it('uses 11px text and status colors', () => {
    expect(cls('running', 'Started')).toContain('bg-status-info-bg');
    cleanup();
    expect(cls('completed', 'Completed')).toContain('bg-status-ok-bg');
    cleanup();
    expect(cls('paused', 'Paused')).toContain('bg-status-paused-bg');
    cleanup();
    expect(cls('errored', 'Errored')).toContain('bg-status-alarm-bg');
    cleanup();
    expect(cls('aborted', 'Aborted')).toContain('bg-status-alarm-bg');
    cleanup();
    const c = cls('pending', 'Waiting');
    expect(c).toContain('text-[11px]');
    expect(c).toContain('bg-muted');
  });
});
