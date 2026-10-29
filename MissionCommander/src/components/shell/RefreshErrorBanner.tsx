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

// Shown by the three detail panels when a same-id refresh() fails but a stale view is
// still mounted (useResourceView keeps it on error by design): keep the user on their
// data instead of swapping the whole panel for an error slot. The specific server
// message was already toasted by the hook.
export function RefreshErrorBanner() {
  return (
    <div role="alert" className="rounded border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-sm text-destructive">
      Couldn&apos;t refresh — showing the last loaded data
    </div>
  );
}
