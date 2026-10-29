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

import { useState, useEffect, useCallback } from 'react'
import { useParams, Link, useNavigate } from 'react-router'
import Editor from '@monaco-editor/react'
import { Button } from '@mission/ui'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useAction, useActiveCode } from './hooks'
import SaveDialog from './SaveDialog'
import VersionHistory from './VersionHistory'
import TestPanel from './TestPanel'
import { api } from '@/lib/api'
import { generateTemplate } from './templates'
import { formatTimestamp } from '@/lib/utils'

export default function InlineCodeEditorPage() {
  const { oid: actionOid, state } = useParams<{ oid: string; state: string }>()
  const navigate = useNavigate()

  const [editorCode, setEditorCode] = useState('')
  const [viewingVersionId, setViewingVersionId] = useState<string | null>(null)
  const [isDirty, setIsDirty] = useState(false)
  const [showTestPanel, setShowTestPanel] = useState(false)
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [showHistorySheet, setShowHistorySheet] = useState(false)

  const { data: actionData } = useAction(actionOid ?? null)
  const {
    data: activeCode,
    isError: activeCodeError,
    isSuccess: activeCodeSuccess,
  } = useActiveCode(actionOid ?? null, state ?? null)

  // Reset editor state when action/state changes
  useEffect(() => {
    setEditorCode('')
    setViewingVersionId(null)
    setIsDirty(false)
    setShowTestPanel(false)
    setShowHistorySheet(false)
  }, [actionOid, state])

  // Load active code when query succeeds (only when not viewing a historical version)
  useEffect(() => {
    if (activeCodeSuccess && activeCode && viewingVersionId === null) {
      setEditorCode(activeCode.source_code)
      setIsDirty(false)
    }
  }, [activeCodeSuccess, activeCode, viewingVersionId])

  // Generate template when no active code exists (404)
  useEffect(() => {
    if (activeCodeError && actionOid && state) {
      const actionName = actionData?.local_id ?? actionOid
      const template = generateTemplate(actionName, state, actionData)
      setEditorCode(template)
      setIsDirty(true)
      setViewingVersionId(null)
    }
  }, [activeCodeError, actionOid, state, actionData])

  const handleSelectVersion = useCallback(
    async (versionId: string) => {
      if (!actionOid || !state) return

      if (versionId === activeCode?.id) {
        setViewingVersionId(null)
        if (activeCode) {
          setEditorCode(activeCode.source_code)
          setIsDirty(false)
        }
        setShowHistorySheet(false)
        return
      }

      try {
        const version = await api.codeVersion(actionOid, state, versionId)
        setEditorCode(version.source_code)
        setViewingVersionId(versionId)
        setIsDirty(false)
        setShowHistorySheet(false)
      } catch {
        // version fetch errors are rare; fail silently
      }
    },
    [actionOid, state, activeCode]
  )

  function handleEditThisVersion() {
    setViewingVersionId(null)
    setIsDirty(true)
  }

  function handleBackToActive() {
    setViewingVersionId(null)
    if (activeCode) {
      setEditorCode(activeCode.source_code)
      setIsDirty(false)
    } else {
      setEditorCode('')
      setIsDirty(false)
    }
  }

  function handleCancel() {
    if (isDirty) {
      const confirmed = window.confirm('Discard unsaved changes?')
      if (!confirmed) return
    }
    if (actionOid) navigate(`/actions/${actionOid}`)
  }

  if (!actionOid || !state) {
    return <div className="text-sm text-muted-foreground">Missing action or state in URL.</div>
  }

  const isReadOnly = viewingVersionId !== null
  const canSave = !isReadOnly && editorCode.length > 0
  const inputSpecs = actionData?.input_parameter_specifications ?? []
  const outputSpecs = actionData?.output_parameter_specifications ?? []

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] gap-2">
      {/* Param bar */}
      <div className="flex flex-col gap-1 px-3 py-2 border rounded bg-muted/30 text-xs shrink-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          {actionData?.environment_oid && (
            <>
              <Link
                to={`/environments/${actionData.environment_oid}`}
                className="text-primary hover:underline"
              >
                {actionData.environment_name}
              </Link>
              <span className="text-muted-foreground">/</span>
            </>
          )}
          <Link to={`/actions/${actionOid}`} className="text-primary hover:underline">
            {actionData?.local_id ?? actionOid}
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="font-mono font-medium text-foreground">{state}</span>

          {viewingVersionId && (
            <span className="ml-2 inline-flex items-center gap-2 text-yellow-700 dark:text-yellow-400 font-medium">
              Viewing old version (read-only)
              <button
                type="button"
                className="text-primary hover:underline font-normal"
                onClick={handleEditThisVersion}
              >
                Edit this version
              </button>
              <button
                type="button"
                className="text-primary hover:underline font-normal"
                onClick={handleBackToActive}
              >
                Back to active
              </button>
            </span>
          )}
          {!viewingVersionId && isDirty && (
            <span className="ml-2 text-orange-600 dark:text-orange-400 font-medium">
              Unsaved changes
            </span>
          )}

          <span className="ml-auto text-muted-foreground">
            {activeCode
              ? `v${activeCode.version_number} · ${formatTimestamp(activeCode.created_at)}`
              : 'no active version'}
          </span>
        </div>

        {(inputSpecs.length > 0 || outputSpecs.length > 0) && (
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
            {inputSpecs.length > 0 && (
              <span>
                <span className="text-foreground/70">in:</span>{' '}
                {inputSpecs.map((p) => `${p.id}:${p.value_type}`).join(', ')}
              </span>
            )}
            {outputSpecs.length > 0 && (
              <span>
                <span className="text-foreground/70">out:</span>{' '}
                {outputSpecs.map((p) => `${p.id}:${p.value_type}`).join(', ')}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Editor + action bar + test panel */}
      <div className="flex-1 flex flex-col min-h-0 border rounded overflow-hidden">
        <div
          className="min-h-0 bg-[#1e1e1e]"
          style={{ flex: showTestPanel ? '0 0 65%' : '1 1 auto' }}
        >
          <Editor
            height="100%"
            language="python"
            value={editorCode}
            onChange={(v) => {
              if (!isReadOnly) {
                setEditorCode(v ?? '')
                setIsDirty(true)
              }
            }}
            theme="vs-dark"
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              tabSize: 4,
              wordWrap: 'on',
              automaticLayout: true,
              readOnly: isReadOnly,
              scrollBeyondLastLine: false,
            }}
          />
        </div>

        <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-t bg-muted/40 text-xs shrink-0">
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleCancel}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={() => setShowSaveDialog(true)}
              disabled={!canSave}
            >
              Save
            </Button>
            <Button
              size="sm"
              variant={showTestPanel ? 'default' : 'outline'}
              className="h-7 text-xs"
              onClick={() => setShowTestPanel((v) => !v)}
            >
              {showTestPanel ? 'Hide Test' : 'Test'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => setShowHistorySheet(true)}
            >
              History
            </Button>
          </div>
          <div className="text-muted-foreground truncate max-w-[60%] text-right">
            {activeCode
              ? `Active: v${activeCode.version_number}${activeCode.description ? ` — ${activeCode.description}` : ''}`
              : 'No active version yet'}
          </div>
        </div>

        {showTestPanel && (
          <div className="flex-1 min-h-0 overflow-y-auto border-t">
            <TestPanel
              actionOid={actionOid}
              state={state}
              code={editorCode}
              inputParameters={inputSpecs}
              outputParameters={outputSpecs}
            />
          </div>
        )}
      </div>

      <SaveDialog
        open={showSaveDialog}
        onOpenChange={setShowSaveDialog}
        actionOid={actionOid}
        state={state}
        code={editorCode}
        onSaved={() => setIsDirty(false)}
      />

      <Sheet open={showHistorySheet} onOpenChange={setShowHistorySheet}>
        <SheetContent side="right" className="w-[360px] sm:max-w-[360px]">
          <SheetHeader>
            <SheetTitle>Version History</SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-4 overflow-y-auto">
            <VersionHistory
              actionOid={actionOid}
              state={state}
              activeVersionId={viewingVersionId}
              onSelectVersion={(id) => void handleSelectVersion(id)}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
