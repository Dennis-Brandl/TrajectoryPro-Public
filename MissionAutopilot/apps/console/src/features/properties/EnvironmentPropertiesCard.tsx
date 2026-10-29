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

import { useUpdateEnvironmentProperties } from '@/features/environments/hooks'
import type { ActionPropertySpec, PropertyEdit } from '@/lib/types'
import { PropertySpecsEditor } from './PropertySpecsEditor'

/**
 * The environment-level Action Properties card (the shared `props` set that
 * state code reads and `set_property()` writes), with inline value editing.
 * Owns its mutation so the page's memoized pane payload need not re-key on
 * mutation state.
 */
export function EnvironmentPropertiesCard({
  environmentOid,
  specs,
}: {
  environmentOid: string
  specs: ActionPropertySpec[]
}) {
  const mutation = useUpdateEnvironmentProperties()
  return (
    <PropertySpecsEditor
      specs={specs}
      onSave={(edits: PropertyEdit[]) => mutation.mutateAsync({ oid: environmentOid, edits })}
      isSaving={mutation.isPending}
      error={mutation.error}
    />
  )
}
