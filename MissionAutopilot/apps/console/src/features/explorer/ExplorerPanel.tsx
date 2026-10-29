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

import { useRef, useState } from 'react'
import { Upload, Filter, X } from 'lucide-react'
import { usePanelContext } from '@/layout/PanelContext'
import { useExplorerData } from './hooks'
import { EnvironmentNode } from './TreeNode'
import { useUploadPackage } from '@/features/environments/hooks'
import {
  PACKAGE_EXTENSIONS,
  PACKAGE_EXTENSIONS_TEXT,
} from '@/features/environments/packageExtensions'
import { cn } from '@mission/ui'

type PanelStatus =
  | { kind: 'idle' }
  | { kind: 'uploading'; filename: string }
  | { kind: 'upload-error'; message: string }
  | { kind: 'action-error'; message: string }

export default function ExplorerPanel() {
  const { tree, isLoading, isError } = useExplorerData()
  const { codeFilterActive, toggleCodeFilter } = usePanelContext()
  const uploadMutation = useUploadPackage()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [panelStatus, setPanelStatus] = useState<PanelStatus>({ kind: 'idle' })

  function handleUploadClick() {
    fileInputRef.current?.click()
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (!file) return
    setPanelStatus({ kind: 'uploading', filename: file.name })
    try {
      await uploadMutation.mutateAsync(file)
      setPanelStatus({ kind: 'idle' })
    } catch (err) {
      setPanelStatus({
        kind: 'upload-error',
        message: err instanceof Error ? err.message : 'Upload failed',
      })
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border shrink-0">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium flex-1">
          Explorer
        </span>
        <button
          onClick={handleUploadClick}
          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          title={`Import ${PACKAGE_EXTENSIONS_TEXT} file`}
        >
          <Upload size={12} />
        </button>
        <button
          onClick={toggleCodeFilter}
          className={cn(
            'p-1 rounded transition-colors',
            codeFilterActive
              ? 'bg-primary/20 text-primary'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted'
          )}
          title={codeFilterActive ? 'Showing states with code only' : 'Show all states'}
        >
          <Filter size={12} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={PACKAGE_EXTENSIONS.join(',')}
          className="hidden"
          onChange={handleFileSelected}
        />
      </div>

      {/* Status row (upload progress / upload or action errors) */}
      {panelStatus.kind === 'uploading' && (
        <div className="px-3 py-1 text-[11px] text-muted-foreground border-b border-border shrink-0">
          Uploading {panelStatus.filename}…
        </div>
      )}
      {(panelStatus.kind === 'upload-error' || panelStatus.kind === 'action-error') && (
        <div className="px-3 py-1.5 text-[11px] text-destructive border-b border-border shrink-0 flex items-start gap-1">
          <span className="flex-1 break-words">
            {panelStatus.kind === 'upload-error' ? 'Upload failed: ' : 'Action failed: '}
            {panelStatus.message}
          </span>
          <button
            onClick={() => setPanelStatus({ kind: 'idle' })}
            className="text-muted-foreground hover:text-foreground shrink-0"
            title="Dismiss"
          >
            <X size={11} />
          </button>
        </div>
      )}

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {isLoading && <p className="px-3 py-2 text-xs text-muted-foreground">Loading...</p>}
        {isError && <p className="px-3 py-2 text-xs text-destructive">Failed to load</p>}
        {!isLoading &&
          !isError &&
          tree.map((env) => (
            <EnvironmentNode
              key={env.oid}
              oid={env.oid}
              localId={env.local_id}
              actions={env.actions}
              actionCount={env.actions.length}
              version={env.version}
              lastModifiedDate={env.last_modified_date}
              onActionError={(message) => setPanelStatus({ kind: 'action-error', message })}
            />
          ))}
        {!isLoading && !isError && tree.length === 0 && (
          <div className="px-3 py-4 text-xs text-muted-foreground text-center">
            <p>No environments yet.</p>
            <button onClick={handleUploadClick} className="mt-2 text-primary hover:underline">
              Import a .WFenvir, .WFenvirX or .WFenvirBundleX file
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
