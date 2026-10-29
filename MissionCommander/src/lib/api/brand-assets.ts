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
// Spec 2026-10-09 §12: Pilot logo uploads. The server detects the type from the bytes, cleans
// SVGs, and answers with the content-hash id a theme then names.
import { postForm } from './client';
import type { BrandAssetView } from './types';

export const brandAssets = {
  upload: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return postForm('/api/brand-assets', form) as Promise<BrandAssetView>;
  },
};

/** Public and immutable (the id is the content hash): safe to use straight in an <img>. */
export const brandAssetUrl = (id: string): string => `/api/brand/${id}`;
