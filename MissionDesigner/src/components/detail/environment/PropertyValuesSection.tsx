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

import { ValuesEditor } from '@/components/properties/ValuesEditor'
import type { ValueSpec, ValueTypeSpec } from '@/types/nodes'

export interface PropertyValuesSectionProps {
  values: ValueSpec[]
  actionProperties: ValueSpec[]
  onValuesChange: (values: ValueSpec[]) => void
  onActionPropertiesChange: (values: ValueSpec[]) => void
  hideHeaders?: boolean
  showValuesOnly?: boolean
  showActionPropertiesOnly?: boolean
  availableValueTypes?: ValueTypeSpec[]
}

/**
 * Renders the "Property Values" and "Action Properties" sections of the
 * Environment detail form, each backed by a ValuesEditor.
 */
export function PropertyValuesSection({
  values,
  actionProperties,
  onValuesChange,
  onActionPropertiesChange,
  hideHeaders = false,
  showValuesOnly = false,
  showActionPropertiesOnly = false,
  availableValueTypes,
}: PropertyValuesSectionProps) {
  const showValues = !showActionPropertiesOnly
  const showActionProps = !showValuesOnly

  return (
    <>
      {showValues && (
        <div className={hideHeaders ? '' : 'border-t border-slate-200 dark:border-slate-700 pt-3'}>
          {!hideHeaders && (
            <h3 className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">Property Values</h3>
          )}
          <ValuesEditor values={values} onChange={onValuesChange} availableValueTypes={availableValueTypes} />
        </div>
      )}

      {showActionProps && (
        <div className={hideHeaders ? '' : 'border-t border-slate-200 dark:border-slate-700 pt-3'}>
          {!hideHeaders && (
            <h3 className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">Action Properties</h3>
          )}
          <ValuesEditor
            values={actionProperties}
            onChange={onActionPropertiesChange}
            label="Action Properties"
            namePlaceholder="Property Name"
            emptyMessage="No action properties defined"
            availableValueTypes={availableValueTypes}
          />
        </div>
      )}
    </>
  )
}
