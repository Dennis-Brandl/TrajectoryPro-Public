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
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { apiErrorMessage } from '@/lib/api/client';

/** The Runtime pane's `act()` helper (runtime/RuntimeWorkflowDetail.tsx) as a hook the three
 *  shared-state panes share (spec §7.3): post → toast → refresh, with NO optimistic write — the
 *  next poll (or this refresh) shows what the engine actually did. A failure ALSO refreshes: the
 *  usual 409 means the live picture moved under the operator, and stale rows would invite a
 *  second wrong click. `busy` disables every action in the pane while one is in flight. */
export function useActionRunner(refresh: () => void) {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn: () => Promise<unknown>, ok: string, fail: string): Promise<void> => {
    setBusy(true);
    try { await fn(); toast.success(ok); refresh(); }
    catch (err) { toast.error(apiErrorMessage(err, fail)); refresh(); }
    finally { setBusy(false); }
  }, [refresh]);
  return { busy, run };
}
