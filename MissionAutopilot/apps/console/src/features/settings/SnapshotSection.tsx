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

import { useState, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@mission/ui'
import { api } from '@/lib/api'
import type { ImportSnapshotResult } from '@/lib/types'

export function SnapshotSection() {
  const [importing, setImporting] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [importResult, setImportResult] = useState<ImportSnapshotResult | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleExport() {
    setImportResult(null)
    setImportError(null)
    api.exportSnapshot().catch((err: unknown) => {
      setImportError(err instanceof Error ? err.message : 'Export failed')
    })
  }

  function handleImportClick() {
    fileInputRef.current?.click()
  }

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setSelectedFile(file)
    setShowConfirm(true)
    setImportResult(null)
    setImportError(null)
  }

  async function handleConfirmImport() {
    if (!selectedFile) return

    setImporting(true)
    setShowConfirm(false)

    try {
      const result = await api.importSnapshot(selectedFile)
      setImportResult(result)
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setImporting(false)
      setSelectedFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function handleCancelImport() {
    setShowConfirm(false)
    setSelectedFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Container Snapshot</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Export or import a full container snapshot including all environments, actions, active
          code, and settings.
        </p>

        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExport}>
            Export Snapshot
          </Button>
          <Button variant="outline" onClick={handleImportClick} disabled={importing}>
            {importing ? 'Importing...' : 'Import Snapshot'}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".WFsnapshot"
            className="hidden"
            onChange={handleFileSelected}
          />
        </div>

        {showConfirm && (
          <div className="rounded-md border border-yellow-300 bg-yellow-50 p-4 space-y-3">
            <p className="font-medium text-yellow-800">Warning: Destructive operation</p>
            <p className="text-sm text-yellow-700">
              Importing a snapshot will <strong>replace all existing data</strong> — environments,
              actions, code versions, and settings will be overwritten.
            </p>
            <p className="text-sm text-yellow-700">
              File: <strong>{selectedFile?.name}</strong>
            </p>
            <div className="flex gap-2">
              <Button variant="destructive" size="sm" onClick={() => void handleConfirmImport()}>
                Confirm Import
              </Button>
              <Button variant="outline" size="sm" onClick={handleCancelImport}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {importResult && (
          <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm">
            <p className="font-medium text-green-800">Import successful</p>
            <p className="text-green-700">
              Imported {importResult.environments_imported} environments,{' '}
              {importResult.actions_imported} actions, {importResult.code_files_imported} code
              files, {importResult.settings_imported} settings
            </p>
          </div>
        )}

        {importError && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm">
            <p className="font-medium text-red-800">Import failed</p>
            <p className="text-red-700">{importError}</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
