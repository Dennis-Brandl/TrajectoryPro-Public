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
import { postForm } from './client';
import type { LoadResponse } from './types';

// One request carries several packages and several target work centers. The server pairs
// them (file × work center) and reports each pair independently, so a corrupt package
// fails only its own pair while its siblings still commit.
//
// This replaced BOTH /workflows/import and /environments/import: routing is by file
// extension server-side, so a steward never picks an artifact type up front.
export const load = {
  load: (workCenterId: string, files: File[], alsoWorkCenterIds: string[]) => {
    const fd = new FormData();
    for (const f of files) fd.append('file', f);
    // The route's own work center is implicit in the URL; these are the EXTRA targets. The
    // server de-duplicates, so passing the current work center here is harmless.
    for (const id of alsoWorkCenterIds) fd.append('alsoWorkCenterId', id);
    return postForm(`/api/work-centers/${workCenterId}/load`, fd) as Promise<LoadResponse>;
  },
};
