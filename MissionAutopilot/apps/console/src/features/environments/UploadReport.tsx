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

import type { UploadResult } from '@/lib/types'

/**
 * What an upload did: the created/updated items, then the reconciliation
 * notes a re-import can produce (see HELP §2 "Re-import"). Empty categories
 * are omitted so a plain first import reads as before.
 */
export function UploadReport({ result }: { result: UploadResult }) {
  const diff = result.diff
  const notes: string[] = []
  if (diff) {
    if (diff.rekeyed.length > 0) {
      notes.push(`Re-keyed to a new OID, code kept: ${diff.rekeyed.join(', ')}`)
    }
    if (diff.orphaned.length > 0) {
      notes.push(`Kept although missing from the package: ${diff.orphaned.join(', ')}`)
    }
    if (diff.signature_changed.length > 0) {
      notes.push(
        `Signature changed, review in the environment: ${diff.signature_changed.join(', ')}`
      )
    }
    if (diff.removed.length > 0) notes.push(`Removed: ${diff.removed.join(', ')}`)
  }

  return (
    <div className="space-y-2">
      {result.imported.length > 0 && (
        <ul className="text-sm space-y-1">
          {result.imported.map((item) => (
            <li key={item.oid} className="flex items-start gap-2">
              <span
                className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${
                  item.status === 'created'
                    ? 'bg-green-100 text-green-700'
                    : 'bg-blue-100 text-blue-700'
                }`}
              >
                {item.status}
              </span>
              <span className="text-foreground">
                <span>
                  {item.type === 'environment'
                    ? `Environment: ${item.local_id} v${item.version}`
                    : `Action: ${item.local_id} v${item.version}`}
                </span>
                {item.rekeyed_from && (
                  <span className="block text-xs text-amber-800">
                    Re-keyed from an earlier import (same name, new OID); actions and code carried
                    over. Workflow packages exported against the previous version pin the old OID:
                    re-export them from Mission Designer.
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {notes.length > 0 && (
        <ul className="text-xs space-y-1 rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-900">
          {notes.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {result.errors.length > 0 && (
        <ul className="text-sm space-y-1">
          {result.errors.map((e, i) => (
            <li key={i} className="text-destructive text-xs">
              {e.filename}: {e.error}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
