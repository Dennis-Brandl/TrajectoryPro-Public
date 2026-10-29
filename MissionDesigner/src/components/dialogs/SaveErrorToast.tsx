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

// Surfaces non-conflict save errors as toast notifications so users
// know when a batch-save fails (e.g., validation errors, network errors).

import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useSaveError } from '@/stores/specificationStore/selectors'
import { editorErrorMessage } from '@/lib/editorErrorMessage'

export function SaveErrorToast() {
  const error = useSaveError()
  const lastShown = useRef<string | null>(null)

  useEffect(() => {
    if (!error) {
      lastShown.current = null
      return
    }
    // Deduplicate — don't show the same error repeatedly
    const key = `${error.status}-${error.code}`
    if (key === lastShown.current) return
    lastShown.current = key

    toast.error(editorErrorMessage(error, `Save failed: ${error.code}`), {
      duration: 8000,
    })
  }, [error])

  return null
}
