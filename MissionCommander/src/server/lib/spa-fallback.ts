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

export type SpaFallback = 'xo' | 'commander' | 'api-404';

/** Which document an unmatched path should get: XO's SPA, Commander's SPA, or a JSON 404. */
export function spaFallbackFile(path: string): SpaFallback {
  if (path.startsWith('/api/')) return 'api-404';
  if (path === '/xo' || path.startsWith('/xo/')) return 'xo';
  return 'commander';
}

/** The bare /xo has no trailing slash, so relative asset URLs would break; send it to /xo/. */
export function xoRedirect(path: string): string | null {
  return path === '/xo' ? '/xo/' : null;
}
