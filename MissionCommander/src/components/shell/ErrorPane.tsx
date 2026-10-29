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
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

// Props are declared inline rather than imported as the router's ErrorComponentProps: a
// component taking FEWER props is assignable where the router expects that type, and this
// way the file does not depend on which of those names 1.87 re-exports.
type Props = { error: unknown; reset: () => void };

/**
 * The router's defaultErrorComponent — the app's only backstop against a single unhandled
 * render error blanking the whole SPA. That is not hypothetical: a prior release shipped a
 * blank page because unvalidated `manifest.warnings` from an uploaded package reached
 * `.map()` with nothing above it to catch the throw.
 *
 * Deliberately does NOT render error.message. These are unhandled render faults whose
 * messages carry stack-adjacent internals of no use to an operator; the console keeps the
 * detail for whoever is debugging. Same reasoning the server's httpError shapes follow.
 *
 * Registered as the router DEFAULT rather than as a hand-rolled class boundary so it covers
 * every route at once and resets on navigation — a user can leave a broken pane by clicking
 * elsewhere instead of reloading.
 */
export function ErrorPane({ error, reset }: Props) {
  useEffect(() => { console.error('Unhandled render error:', error); }, [error]);
  return (
    <div role="alert" className="flex flex-col items-start gap-3 p-6">
      <h2 className="text-lg font-semibold">Something went wrong</h2>
      <p className="text-sm text-muted-foreground">
        This view could not be displayed. You can retry, or pick another item.
      </p>
      <Button type="button" variant="outline" size="sm" onClick={reset}>Try again</Button>
    </div>
  );
}
