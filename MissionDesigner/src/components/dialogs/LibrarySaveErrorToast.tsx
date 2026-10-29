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

// Surfaces library-CRUD save failures (rename/delete/create/metadata edits) as
// friendly toasts — the sibling of SaveErrorToast for the library code path.

import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useLibrarySaveError } from '@/stores/specificationStore/selectors'
import { editorErrorMessage } from '@/lib/editorErrorMessage'

export function LibrarySaveErrorToast() {
  const error = useLibrarySaveError()
  const lastShown = useRef<string | null>(null)

  useEffect(() => {
    if (!error) {
      lastShown.current = null
      return
    }
    const key = `${error.status}-${error.code}`
    if (key === lastShown.current) return
    lastShown.current = key
    toast.error(editorErrorMessage(error, `Library save failed: ${error.code}`), { duration: 8000 })
  }, [error])

  return null
}
