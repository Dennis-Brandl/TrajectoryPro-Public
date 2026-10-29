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

import { memo, useCallback } from 'react'
import { Label } from '@mission/ui'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@mission/ui'
import type { StepNodeData } from '@/types/nodes'

interface YesNoStepConfigProps {
  data: StepNodeData
  onChange: (updates: Partial<StepNodeData>) => void
  readOnly?: boolean
}

/**
 * Configuration component for Yes/No Step.
 * Handles default selection. Output values are fixed: Yes="true", No="false".
 */
function YesNoStepConfigComponent({ data, onChange, readOnly = false }: YesNoStepConfigProps) {
  const handleDefaultSelectionChange = useCallback(
    (value: string) => {
      onChange({ yesNoDefaultSelection: value as 'yes' | 'no' | 'none' })
    },
    [onChange],
  )

  return (
    <div className="space-y-4 border-t border-slate-200 dark:border-slate-700 pt-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wide">
          Yes/No Configuration
        </span>
      </div>

      {/* Default Selection */}
      <div className="space-y-1 border-t border-slate-100 dark:border-slate-800 pt-3">
        <Label className="text-xs text-slate-500 dark:text-slate-400">Default Selection</Label>
        <Select
          value={data.yesNoDefaultSelection || 'none'}
          onValueChange={handleDefaultSelectionChange}
          disabled={readOnly}
        >
          <SelectTrigger className="h-7 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None (require selection)</SelectItem>
            <SelectItem value="yes">
              {data.uiParameters?.find((p) => p.type === 'YesNoButtons')?.value || 'Yes'} (pre-selected)
            </SelectItem>
            <SelectItem value="no">
              {(() => {
                const b = data.uiParameters?.find((p) => p.type === 'YesNoButtons')
                return b && 'value2' in b ? (b as { value2: string }).value2 : 'No'
              })()}{' '}
              (pre-selected)
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="text-[10px] text-slate-400 dark:text-slate-500">Which option is selected by default at runtime</p>
      </div>
    </div>
  )
}

export const YesNoStepConfig = memo(YesNoStepConfigComponent)
