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
import { useMemo } from 'react'
import { useLibraryStore } from '@/stores/libraryStore'
import { useSpecificationStore } from '@/stores/specificationStore'
import { getSpecImages } from '@/stores/specificationStore/imageHelpers'

export function resolveImageSrc(srcKey: string, images: Record<string, string>): string | undefined {
  if (srcKey.startsWith('http://') || srcKey.startsWith('https://')) return srcKey
  return images[srcKey]
}

/** Stable `(srcKey) => url` resolver for FormDocumentView's `images` prop, sourced from the
 *  active spec's image map. Re-subscribes when the active spec or its images change. */
export function useImageResolver(): (srcKey: string) => string | undefined {
  const selectedSpecId = useLibraryStore((s) => s.selectedSpecificationId)
  const images = useSpecificationStore((s) => {
    if (!selectedSpecId) return undefined
    return (s.specs.get(selectedSpecId)?.data as { images?: Record<string, string> } | undefined)?.images
  })
  return useMemo(() => {
    const map = images ?? getSpecImages(selectedSpecId)
    return (srcKey: string) => resolveImageSrc(srcKey, map)
  }, [images, selectedSpecId])
}
