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

import { useCallback, useState, memo } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Button } from '@mission/ui'
import CodeMirror from '@uiw/react-codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { oneDark } from '@codemirror/theme-one-dark'
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint'
import { toast } from 'sonner'
import { useTheme } from '@/hooks/useTheme'
import type { StepNodeData } from '@/types/nodes'
import { scriptTemplate } from './script-template'

interface ScriptEditorModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  data: StepNodeData
  onChange: (updates: Partial<StepNodeData>) => void
  /** 'gate' tailors the title, template generation, and tooltip for a GATE step's boolean script. */
  variant?: 'script' | 'gate'
}

type SyntaxCheckResult = { ok: true } | { ok: false; line: number; column: number; message: string }

// V8 wraps `new Function(body)` as `function anonymous(\n) {\n<body>\n}`, so
// stack-trace line numbers are offset by 2 from the user's source.
const FUNCTION_BODY_LINE_OFFSET = 2

function checkScriptSyntax(source: string): SyntaxCheckResult {
  try {
    new Function(source)
    return { ok: true }
  } catch (e) {
    if (e instanceof SyntaxError) {
      const stack = e.stack || ''
      const m = stack.match(/<anonymous>:(\d+):(\d+)/)
      const line = m ? Math.max(1, Number(m[1]) - FUNCTION_BODY_LINE_OFFSET) : 1
      const column = m ? Math.max(1, Number(m[2])) : 1
      return { ok: false, line, column, message: e.message }
    }
    return { ok: false, line: 1, column: 1, message: e instanceof Error ? e.message : String(e) }
  }
}

const jsSyntaxLinter = linter(
  (view) => {
    const result = checkScriptSyntax(view.state.doc.toString())
    if (result.ok) return []
    const lineCount = view.state.doc.lines
    const targetLine = Math.min(Math.max(1, result.line), lineCount)
    const lineInfo = view.state.doc.line(targetLine)
    const from = Math.min(lineInfo.from + Math.max(0, result.column - 1), lineInfo.to)
    const to = Math.min(from + 1, lineInfo.to)
    const diagnostic: Diagnostic = {
      from,
      to: to > from ? to : Math.min(from + 1, view.state.doc.length),
      severity: 'error',
      message: result.message,
    }
    return [diagnostic]
  },
  { delay: 300 },
)

const extensions = [javascript(), jsSyntaxLinter, lintGutter()]

function ScriptEditorModalComponent({
  open,
  onOpenChange,
  data,
  onChange,
  variant = 'script',
}: ScriptEditorModalProps) {
  const isGate = variant === 'gate'
  const { theme } = useTheme()

  // Buffer edits locally — only commit to node data on explicit Save.
  // `savedSource` is the last committed text, kept in state (not a ref)
  // because `isDirty` is derived from it during render.
  const [localSource, setLocalSource] = useState(data.scriptSource || '')
  const [savedSource, setSavedSource] = useState(data.scriptSource || '')

  // Re-seed both buffers when the modal opens or a different node opens the
  // editor. Adjust-state-during-render (react.dev "storing information from
  // previous renders") rather than an effect.
  const incomingSource = data.scriptSource || ''
  const [seededFrom, setSeededFrom] = useState({ open, source: incomingSource })
  if (seededFrom.open !== open || seededFrom.source !== incomingSource) {
    setSeededFrom({ open, source: incomingSource })
    if (open) {
      setLocalSource(incomingSource)
      setSavedSource(incomingSource)
    }
  }

  const isDirty = localSource !== savedSource

  const handleLocalChange = useCallback((value: string) => {
    setLocalSource(value)
  }, [])

  const handleSave = useCallback(() => {
    onChange({ scriptSource: localSource, scriptLanguage: 'javascript' })
    setSavedSource(localSource)
  }, [localSource, onChange])

  const handleSaveAndClose = useCallback(() => {
    onChange({ scriptSource: localSource, scriptLanguage: 'javascript' })
    setSavedSource(localSource)
    onOpenChange(false)
  }, [localSource, onChange, onOpenChange])

  const handleCancel = useCallback(() => {
    // Discard local edits — node data is unchanged
    setLocalSource(savedSource)
    onOpenChange(false)
  }, [savedSource, onOpenChange])

  const handleCheckSyntax = useCallback(() => {
    const result = checkScriptSyntax(localSource)
    if (result.ok) {
      toast.success('Script syntax OK')
    } else {
      toast.error(`Syntax error on line ${result.line}: ${result.message}`)
    }
  }, [localSource])

  const handleGenerateTemplate = useCallback(() => {
    setLocalSource(
      scriptTemplate({
        inputs: (data.inputs || []).filter((p) => p.name),
        outputs: (data.outputs || []).filter((p) => p.name),
        variant: isGate ? 'gate' : 'script',
        repeat: !isGate && data.scriptRepeat === true,
      }),
    )
  }, [data.inputs, data.outputs, data.scriptRepeat, isGate])

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/80" />
        <Dialog.Content
          className="fixed inset-4 z-50 bg-white dark:bg-slate-900 rounded-lg flex flex-col overflow-hidden"
          onEscapeKeyDown={(e) => {
            e.preventDefault()
            handleCancel()
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700 shrink-0">
            <Dialog.Title className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              {isGate ? 'Edit Gate Script' : 'Edit Script'}
            </Dialog.Title>
            <Dialog.Description className="sr-only">
              Full-screen JavaScript code editor for the script step
            </Dialog.Description>
          </div>

          {/* Toolbar */}
          <div className="px-4 py-2 border-b border-slate-100 dark:border-slate-800 shrink-0 flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleGenerateTemplate}
              className="h-7 text-xs"
              title={
                isGate
                  ? "Generates a gate script template from the step's input parameters.\n\n" +
                    'Input parameters are available as variables using their name.\n' +
                    'All input values are strings — use Number() to convert for math.\n\n' +
                    'The script RETURNS its verdict:\n' +
                    '  return Number(temperature) > 100;\n' +
                    'TRUE opens the gate; FALSE repeats next cycle.'
                  : "Generates a script template from the step's parameters.\n\n" +
                    'Input parameters are available as variables using their name:\n' +
                    '  e.g. input parameter "temperature" → temperature\n\n' +
                    'Output parameters are set via the output object:\n' +
                    '  e.g. output parameter "result"\n' +
                    '  output.result = Number(temperature) * 1.8 + 32\n\n' +
                    'All input values are strings. Use Number() to convert for math.' +
                    '\n\nRepeat until done: the script runs every cycle until it returns true;\n' +
                    '  state keeps values between runs, e.g. state.count = (state.count || 0) + 1'
              }
            >
              Generate Template
            </Button>
            <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium ml-auto">JavaScript</span>
          </div>

          {/* Editor body */}
          <div className="flex-1 overflow-auto">
            <div className="h-full" onKeyDown={(e) => e.stopPropagation()}>
              <CodeMirror
                value={localSource}
                onChange={handleLocalChange}
                extensions={extensions}
                theme={theme === 'dark' ? oneDark : 'light'}
                height="100%"
                style={{ height: '100%' }}
                basicSetup={{
                  lineNumbers: true,
                  foldGutter: true,
                  highlightActiveLine: true,
                }}
              />
            </div>
          </div>

          {/* Footer with Cancel / Check Syntax / Save / Save and Close */}
          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-slate-200 dark:border-slate-700 shrink-0">
            <Button variant="outline" size="sm" onClick={handleCancel}>
              Cancel
            </Button>
            <Button variant="outline" size="sm" onClick={handleCheckSyntax}>
              Check Syntax
            </Button>
            <Button variant="outline" size="sm" onClick={handleSave} disabled={!isDirty}>
              Save
            </Button>
            <Button size="sm" onClick={handleSaveAndClose}>
              Save and Close
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export const ScriptEditorModal = memo(ScriptEditorModalComponent)
