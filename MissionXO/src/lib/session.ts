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
import { setAppHeaders, setUnauthorizedHandler } from '@/lib/api/client';
import { APP_HEADER, XO_APP } from '@/lib/app-header';

const LOGIN = '/xo/login';

/** Marks every API call as XO's, so the server checks XO's own sign-in, not Commander's. */
export function installXoAppHeader(): void {
  setAppHeaders({ [APP_HEADER]: XO_APP });
}

/** A 401 means the session is gone: hard-navigate to XO's own sign-in page. */
export function installUnauthorizedRedirect(): void {
  setUnauthorizedHandler(() => {
    if (typeof window === 'undefined') return;
    if (window.location.pathname === LOGIN) return;
    window.location.assign(LOGIN);
  });
}
