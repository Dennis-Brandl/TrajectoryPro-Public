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

import { useUpdateActionProperties } from '@/features/actions/hooks'
import type { ActionPropertySpec, PropertyEdit } from '@/lib/types'
import { PropertySpecsEditor } from './PropertySpecsEditor'

/**
 * One action's own Action Properties card (the read-only-from-code
 * `action_props` set), with inline value editing. Owns its mutation so the
 * page's memoized pane payload need not re-key on mutation state.
 */
export function ActionPropertiesCard({
  actionOid,
  specs,
}: {
  actionOid: string
  specs: ActionPropertySpec[]
}) {
  const mutation = useUpdateActionProperties()
  return (
    <PropertySpecsEditor
      specs={specs}
      onSave={(edits: PropertyEdit[]) => mutation.mutateAsync({ oid: actionOid, edits })}
      isSaving={mutation.isPending}
      error={mutation.error}
    />
  )
}
