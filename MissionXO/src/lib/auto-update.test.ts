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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { applyWhenSafe, checkForUpdates, IDLE_BEFORE_UPDATE_MS, UPDATE_CHECK_MS } from './auto-update';

let visibility: DocumentVisibilityState = 'visible';
function setVisibility(v: DocumentVisibilityState) {
  visibility = v;
  document.dispatchEvent(new Event('visibilitychange'));
}
beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
});
afterEach(() => { vi.useRealTimers(); });

describe('applyWhenSafe', () => {
  it('applies after the idle wait when nobody is typing or tapping', () => {
    const apply = vi.fn();
    applyWhenSafe(apply);
    vi.advanceTimersByTime(IDLE_BEFORE_UPDATE_MS - 1);
    expect(apply).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('waits while someone keeps typing, so a half-filled form is not wiped', () => {
    const apply = vi.fn();
    applyWhenSafe(apply);
    for (let i = 0; i < 5; i += 1) {
      vi.advanceTimersByTime(IDLE_BEFORE_UPDATE_MS - 1000);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    }
    expect(apply).not.toHaveBeenCalled();
    vi.advanceTimersByTime(IDLE_BEFORE_UPDATE_MS);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('applies at once when the tab is hidden, and only once', () => {
    const apply = vi.fn();
    applyWhenSafe(apply);
    setVisibility('hidden');
    expect(apply).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(IDLE_BEFORE_UPDATE_MS * 2);
    setVisibility('visible');
    setVisibility('hidden');
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('applies straight away when the tab is already hidden', () => {
    visibility = 'hidden';
    const apply = vi.fn();
    applyWhenSafe(apply);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('cancel stops it', () => {
    const apply = vi.fn();
    const cancel = applyWhenSafe(apply);
    cancel();
    vi.advanceTimersByTime(IDLE_BEFORE_UPDATE_MS * 2);
    setVisibility('hidden');
    expect(apply).not.toHaveBeenCalled();
  });
});

describe('checkForUpdates', () => {
  it('checks on its interval and when the tab comes back into view', () => {
    const update = vi.fn();
    const stop = checkForUpdates(update);
    vi.advanceTimersByTime(UPDATE_CHECK_MS);
    expect(update).toHaveBeenCalledTimes(1);
    setVisibility('hidden');
    setVisibility('visible');
    expect(update).toHaveBeenCalledTimes(2);
    stop();
    vi.advanceTimersByTime(UPDATE_CHECK_MS * 3);
    setVisibility('visible');
    expect(update).toHaveBeenCalledTimes(2);
  });
});
