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
import { Button } from '@mission/ui'
import CodeMirror from '@uiw/react-codemirror'
import { javascript } from '@codemirror/lang-javascript'
import type { StepNodeData } from '@/types/nodes'

interface ScriptStepConfigProps {
  data: StepNodeData
  onChange: (updates: Partial<StepNodeData>) => void
  readOnly?: boolean
}

const extensions = [javascript()]

function ScriptStepConfigComponent({ data, onChange, readOnly = false }: ScriptStepConfigProps) {
  const handleSourceChange = useCallback(
    (value: string) => {
      onChange({ scriptSource: value, scriptLanguage: 'javascript' })
    },
    [onChange],
  )

  const handleGenerateTemplate = useCallback(() => {
    const inputs = (data.inputs || []).filter((p) => p.name)
    const outputs = (data.outputs || []).filter((p) => p.name)

    const lines: string[] = ['// Auto-generated script template', '']

    for (const p of inputs) {
      const desc = p.description ? ` - ${p.description}` : ''
      lines.push(`//INPUT: ${p.name}${desc}`)
    }

    if (inputs.length > 0) lines.push('')

    for (const p of outputs) {
      const desc = p.description ? ` - ${p.description}` : ''
      lines.push(`//OUTPUT: ${p.name}${desc}`)
    }

    lines.push('')
    lines.push('return true;')

    onChange({ scriptSource: lines.join('\n'), scriptLanguage: 'javascript' })
  }, [data.inputs, data.outputs, onChange])

  return (
    <div className="space-y-3 border-t border-slate-200 dark:border-slate-700 pt-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wide">
          Script Editor
        </span>
        <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">JavaScript</span>
      </div>

      {!readOnly && (
        <Button variant="outline" size="sm" onClick={handleGenerateTemplate} className="h-6 text-xs">
          Generate Template
        </Button>
      )}

      <div className="space-y-1">
        <Label className="text-xs text-slate-500 dark:text-slate-400">Source Code</Label>
        <div
          className="border border-slate-200 dark:border-slate-700 rounded-md overflow-hidden"
          onKeyDown={(e) => e.stopPropagation()}
        >
          <CodeMirror
            value={data.scriptSource || ''}
            onChange={handleSourceChange}
            extensions={extensions}
            readOnly={readOnly}
            height="200px"
            basicSetup={{
              lineNumbers: true,
              foldGutter: false,
              highlightActiveLine: !readOnly,
            }}
          />
        </div>
      </div>
    </div>
  )
}

export const ScriptStepConfig = memo(ScriptStepConfigComponent)
