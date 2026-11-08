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
import { authClient } from '@/lib/auth/auth-client';

/**
 * When the tab comes back into view, ask the server who this browser is signed in as. If it
 * is no longer the user the page shows (someone signed in as another account in another
 * tab), reload, so the page never acts as one person while showing another (2026-11-08).
 */
export function useSignedInUserCheck(shownUserId: string | undefined): void {
  useEffect(() => {
    if (!shownUserId) return;
    let checking = false;
    const check = async () => {
      if (checking || document.visibilityState !== 'visible') return;
      checking = true;
      try {
        const session = await authClient.getSession();
        const signedInId = session?.data?.user?.id;
        // No session: the next API call's 401 already sends the user to sign-in.
        if (signedInId && signedInId !== shownUserId) window.location.reload();
      } catch {
        /* offline: keep the page as it is */
      } finally {
        checking = false;
      }
    };
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [shownUserId]);
}
