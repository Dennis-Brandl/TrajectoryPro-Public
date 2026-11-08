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
import { useRegisterSW } from 'virtual:pwa-register/react';

/** Bar shown on every screen when a new service-worker build is waiting. */
export function UpdatePrompt() {
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW();
  if (!needRefresh) return null;
  return (
    <div
      role="status"
      data-testid="xo-update-prompt"
      className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-md border bg-card px-4 py-2 text-sm text-card-foreground shadow-lg"
    >
      <span>A new version is available —</span>
      <button
        type="button"
        className="min-h-11 rounded-md bg-primary px-3 py-1 font-medium text-primary-foreground xl:min-h-0"
        onClick={() => { void updateServiceWorker(true); }}
      >
        Reload
      </button>
    </div>
  );
}
