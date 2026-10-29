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

import { memo } from 'react'
import { Label } from '@mission/ui'
import type { Select1OptionSpec, StepNodeData } from '@/types/nodes'
import { describeSelect1Option } from '@/lib/select1-condition'

interface EdgeConditionEditorProps {
  sourceNodeData: StepNodeData
  sourceHandleId: string | null | undefined
  sourceNodeLabel: string
}

function EdgeConditionEditorComponent({ sourceNodeData, sourceHandleId, sourceNodeLabel }: EdgeConditionEditorProps) {
  const desc = describeSelect1Option(sourceNodeData, sourceHandleId)
  const option = ((sourceNodeData.select1Options || []) as Select1OptionSpec[]).find((o) => o.id === sourceHandleId)
  const isProperty = sourceNodeData.select1InputValueType === 'property' || option?.valueType === 'property'
  const muted = 'text-xs text-slate-500 dark:text-slate-400'

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-sm font-medium">Condition</Label>
        <p className={`${muted} mt-1`}>Condition for branch from "{sourceNodeLabel}"</p>
      </div>

      {desc.kind === 'condition' && (
        <div className="space-y-1">
          <div className="rounded border border-slate-200 dark:border-slate-700 px-2 py-1.5 text-sm font-mono break-all">
            {desc.text}
          </div>
          {desc.label && <p className={muted}>Option: {desc.label}</p>}
          {isProperty && <p className={muted}>The value or input is a value property reference.</p>}
        </div>
      )}
      {desc.kind === 'default' && (
        <div className="space-y-1">
          <p className="text-sm">Default — taken when no other option matches</p>
          {desc.label && <p className={muted}>Option: {desc.label}</p>}
        </div>
      )}
      {desc.kind === 'unconfigured' && (
        <p className={muted}>Not configured yet — set the comparison value on the SELECT 1 step.</p>
      )}
      {desc.kind === 'missing' && <p className={muted}>This connection is not linked to a SELECT 1 option.</p>}

      <p className="text-xs text-slate-400 dark:text-slate-500">Edit conditions on the SELECT 1 step.</p>
    </div>
  )
}

export const EdgeConditionEditor = memo(EdgeConditionEditorComponent)
