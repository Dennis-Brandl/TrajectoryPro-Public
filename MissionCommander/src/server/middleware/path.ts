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

// Canonicalize a request path before policy matching. better-auth and Hono may disagree
// on trailing slashes, duplicate separators, or half-decoded escapes (%2F survives Hono's
// decodeURI). Both the admin allowlist and the signup gate must see the same spelling that
// could reach better-auth's router. NOTE: this decodes %-escapes and normalizes '/'
// separators only — it does NOT fold Unicode-confusable separators (e.g. fullwidth '／').
// Such spellings fall through to better-auth, which does not route them to a real handler
// (its router doesn't fold them either), so they 404 there; the allowlist's default-closed
// posture is what removes the reliance on that coincidence for genuinely '/'-separated paths.
export function canonicalize(path: string): string {
  let p = path;
  try {
    p = decodeURIComponent(p);
  } catch {
    /* malformed escape (lone %, %zz): match the raw form */
  }
  p = p.replace(/\/{2,}/g, '/'); // collapse duplicate separators
  p = p.replace(/\/+$/, ''); // strip trailing separators
  return p;
}
