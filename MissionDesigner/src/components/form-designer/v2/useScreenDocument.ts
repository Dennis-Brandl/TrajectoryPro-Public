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
import type { FormDocument } from '@mission/form-schema'
import { useFormDocumentStore } from '@/stores/formDocumentStore'
import { projectForScreen } from '@/lib/form-document/screen-rows'

/** The open form as the active Desktop / Tablet / Phone tab shows it: that screen's rows as plain
 *  `rows`. Anything that reads rows or neighbours (canvas, drop targets, column commands) uses
 *  this; readers that only need a block's content can use the store document (same blocks). */
export function useScreenDocument(): FormDocument {
  const document = useFormDocumentStore((s) => s.document)
  const breakpoint = useFormDocumentStore((s) => s.activeBreakpoint)
  return useMemo(() => projectForScreen(document, breakpoint), [document, breakpoint])
}
