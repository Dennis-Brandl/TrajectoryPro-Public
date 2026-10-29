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
import { get, postForm } from './client';
import type { ImportReport, PackagePreview, PackageScope } from './types';

export const packages = {
  preview: (id: string, scope: PackageScope) =>
    get(`/api/work-centers/${encodeURIComponent(id)}/package/preview?scope=${scope}`) as Promise<PackagePreview>,
  /**
   * A URL rather than a fetch: the response is a file, and letting the browser navigate to
   * it is what produces a real download with the server's Content-Disposition filename.
   * Fetching it into memory would mean re-deriving that filename on the client.
   */
  downloadUrl: (id: string, scope: PackageScope) =>
    `/api/work-centers/${encodeURIComponent(id)}/package?scope=${scope}`,
  import: (file: File, opts:
    | { mode: 'create'; parentWorkCenterId: string | null }
    | { mode: 'merge'; targetWorkCenterId: string; confirmed: boolean }) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('mode', opts.mode);
    if (opts.mode === 'create') {
      if (opts.parentWorkCenterId) fd.append('parentWorkCenterId', opts.parentWorkCenterId);
    } else {
      fd.append('targetWorkCenterId', opts.targetWorkCenterId);
      // Only ever the literal "true"; the server compares strictly (§8.9).
      if (opts.confirmed) fd.append('confirmed', 'true');
    }
    return postForm('/api/work-centers/import', fd) as Promise<ImportReport>;
  },
};
