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

import { useState, useEffect } from 'react'
import { Button } from '@mission/ui'
import { CheckCircle2, AlertTriangle, XCircle, RefreshCw } from 'lucide-react'

interface TableResult {
  table: string
  status: 'ok' | 'missing_table' | 'missing_columns' | 'extra_columns' | 'unexpected_table'
  missingColumns: string[]
  extraColumns: string[]
  fixed: string[]
}

interface DbCheckResponse {
  status: 'ok' | 'mismatch'
  tables: TableResult[]
}

export function DatabaseTab() {
  const [results, setResults] = useState<DbCheckResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [fixing, setFixing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const runCheck = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/db-check')
      if (!res.ok) throw new Error('Failed to check database')
      setResults(await res.json())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  const runFix = async () => {
    setFixing(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/db-fix', { method: 'POST' })
      if (!res.ok) throw new Error('Failed to fix database')
      setResults(await res.json())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setFixing(false)
    }
  }

  useEffect(() => {
    runCheck()
  }, [])

  const hasMismatch = results?.status === 'mismatch'
  const hasFixable = results?.tables.some((t) => t.missingColumns.length > 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Database Schema Check</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Compares the active database against the expected schema for this build.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={runCheck} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            Recheck
          </Button>
          {hasFixable && (
            <Button size="sm" onClick={runFix} disabled={fixing}>
              {fixing ? 'Fixing...' : 'Fix Missing Columns'}
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-3">
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {results && (
        <>
          {/* Overall status banner */}
          <div
            className={`rounded-md border p-3 flex items-center gap-2 ${
              hasMismatch
                ? 'border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300'
                : 'border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-950/40 text-green-800 dark:text-green-300'
            }`}
          >
            {hasMismatch ? (
              <>
                <AlertTriangle className="h-5 w-5 shrink-0" />
                <span className="text-sm font-medium">Schema mismatch detected. Some tables need updates.</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="h-5 w-5 shrink-0" />
                <span className="text-sm font-medium">Database schema matches the expected build schema.</span>
              </>
            )}
          </div>

          {/* Table-by-table results */}
          <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden bg-white dark:bg-slate-900">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                  <th className="text-left px-4 py-2 font-medium text-slate-600 dark:text-slate-300">Table</th>
                  <th className="text-left px-4 py-2 font-medium text-slate-600 dark:text-slate-300">Status</th>
                  <th className="text-left px-4 py-2 font-medium text-slate-600 dark:text-slate-300">Details</th>
                </tr>
              </thead>
              <tbody>
                {results.tables.map((t) => (
                  <tr key={t.table} className="border-b border-slate-200 dark:border-slate-700 last:border-b-0">
                    <td className="px-4 py-2 font-mono text-slate-700 dark:text-slate-200">{t.table}</td>
                    <td className="px-4 py-2">
                      {t.status === 'ok' ? (
                        <span className="inline-flex items-center gap-1 text-green-700 dark:text-green-400">
                          <CheckCircle2 className="h-4 w-4" /> OK
                        </span>
                      ) : t.status === 'missing_table' ? (
                        <span className="inline-flex items-center gap-1 text-red-700 dark:text-red-400">
                          <XCircle className="h-4 w-4" /> Missing
                        </span>
                      ) : t.status === 'missing_columns' ? (
                        <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                          <AlertTriangle className="h-4 w-4" /> Missing columns
                        </span>
                      ) : t.status === 'unexpected_table' ? (
                        <span className="inline-flex items-center gap-1 text-blue-700 dark:text-blue-400">
                          <AlertTriangle className="h-4 w-4" /> Unexpected table
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-blue-700 dark:text-blue-400">
                          <AlertTriangle className="h-4 w-4" /> Extra columns
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-slate-500 dark:text-slate-400">
                      {t.fixed.length > 0 && (
                        <span className="text-green-700 dark:text-green-400">
                          Fixed: <span className="font-mono">{t.fixed.join(', ')}</span>
                        </span>
                      )}
                      {t.missingColumns.length > 0 && t.fixed.length === 0 && (
                        <span className="text-amber-700 dark:text-amber-400">
                          Missing: <span className="font-mono">{t.missingColumns.join(', ')}</span>
                        </span>
                      )}
                      {t.status === 'unexpected_table' && (
                        <span className="text-blue-600 dark:text-blue-400">
                          Not in expected schema. Columns:{' '}
                          <span className="font-mono">{t.extraColumns.join(', ')}</span>
                        </span>
                      )}
                      {t.status !== 'unexpected_table' && t.extraColumns.length > 0 && (
                        <span className="text-blue-600 dark:text-blue-400">
                          Extra: <span className="font-mono">{t.extraColumns.join(', ')}</span>
                        </span>
                      )}
                      {t.status === 'ok' && t.fixed.length === 0 && (
                        <span className="text-slate-400 dark:text-slate-500">All columns present</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
