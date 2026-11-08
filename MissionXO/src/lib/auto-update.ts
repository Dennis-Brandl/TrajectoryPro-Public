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

// XO updates itself after a deploy (user decision, 2026-11-08): the browser keeps running
// its saved copy until a new build is applied, which once left the old sign-in code running.
// A reload must not wipe a half-filled Start form, so the new build is applied only at a
// safe moment: when the tab is hidden, or after a spell with no typing or tapping.

/** How often a running XO asks the server whether a new build is out. */
export const UPDATE_CHECK_MS = 5 * 60_000;
/** How long with no typing or tapping before an update may reload a visible page. */
export const IDLE_BEFORE_UPDATE_MS = 2 * 60_000;

const ACTIVITY = ['keydown', 'pointerdown', 'input', 'wheel', 'touchstart'] as const;

/** Calls apply once, at the first safe moment. Returns a function that cancels it. */
export function applyWhenSafe(apply: () => void, idleMs = IDLE_BEFORE_UPDATE_MS): () => void {
  let done = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fire = () => {
    if (done) return;
    cancel();
    done = true;
    apply();
  };
  const restart = () => {
    clearTimeout(timer);
    timer = setTimeout(fire, idleMs);
  };
  const onVisibility = () => { if (document.visibilityState === 'hidden') fire(); };
  function cancel() {
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisibility);
    for (const e of ACTIVITY) window.removeEventListener(e, restart, true);
  }
  if (document.visibilityState === 'hidden') { fire(); return () => {}; }
  document.addEventListener('visibilitychange', onVisibility);
  for (const e of ACTIVITY) window.addEventListener(e, restart, true);
  restart();
  return () => { done = true; cancel(); };
}

/** Asks for a new build every intervalMs and whenever the tab comes back into view. */
export function checkForUpdates(update: () => void, intervalMs = UPDATE_CHECK_MS): () => void {
  const interval = setInterval(update, intervalMs);
  const onVisibility = () => { if (document.visibilityState === 'visible') update(); };
  document.addEventListener('visibilitychange', onVisibility);
  return () => { clearInterval(interval); document.removeEventListener('visibilitychange', onVisibility); };
}
