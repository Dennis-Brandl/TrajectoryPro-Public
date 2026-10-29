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
import { Button } from '@mission/ui'
import { api } from '@/lib/api'
import type { ImportCodeResult } from '@/lib/types'

interface ExportImportButtonsProps {
  actionOid: string
  onImportComplete: () => void
}

export function ExportImportButtons({ actionOid, onImportComplete }: ExportImportButtonsProps) {
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<ImportCodeResult | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleExport() {
    setImportResult(null)
    setImportError(null)
    api.exportActionCode(actionOid).catch((err: unknown) => {
      setImportError(err instanceof Error ? err.message : 'Export failed')
    })
  }

  function handleImportClick() {
    fileInputRef.current?.click()
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setImporting(true)
    setImportResult(null)
    setImportError(null)

    try {
      const result = await api.importActionCode(actionOid, file)
      setImportResult(result)
      onImportComplete()
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={handleExport}>
          Export Code
        </Button>
        <Button variant="outline" size="sm" onClick={handleImportClick} disabled={importing}>
          {importing ? 'Importing...' : 'Import Code'}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".WFactionCode"
          className="hidden"
          onChange={handleFileSelected}
        />
      </div>

      {importResult && (
        <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm">
          <p className="font-medium text-green-800">Import successful</p>
          <p className="text-green-700">
            Imported: {importResult.imported_states.join(', ') || 'none'}
            {importResult.skipped_states.length > 0 &&
              ` | Skipped: ${importResult.skipped_states.join(', ')}`}
          </p>
        </div>
      )}

      {importError && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm">
          <p className="font-medium text-red-800">Import failed</p>
          <p className="text-red-700">{importError}</p>
        </div>
      )}
    </div>
  )
}
