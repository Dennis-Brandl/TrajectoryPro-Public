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

import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Button } from '@mission/ui'
import type { PostImportReport } from '@/types/wflibx-import'
import { REFUSAL_LABEL, changedSinceExportDetail } from './import-report-summary'

interface Props {
  open: boolean
  report: PostImportReport
  onClose: () => void
}

export function PostImportReportDialog({ open, report, onClose }: Props) {
  const dangling = report.danglingReferences.length
  const refused = report.refused.length
  const handleCopyCsv = async () => {
    const lines = ['referrerOid,referrerName,referrerEntityType,brokenReferenceTo']
    for (const r of report.danglingReferences) {
      lines.push([r.referrerOid, r.referrerName, r.referrerEntityType, r.brokenReferenceTo].join(','))
    }
    await navigator.clipboard.writeText(lines.join('\n'))
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? onClose() : null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {dangling > 0 ? 'Import complete — review broken references' : 'Import complete — review refused specs'}
          </DialogTitle>
        </DialogHeader>

        {refused > 0 && (
          <>
            <p className="text-sm">
              {refused} existing spec(s) were not replaced and were kept as they are. To replace a released spec, change
              its state first; for one changed here since export, export a fresh copy.
            </p>
            <ul className="text-sm space-y-1">
              {report.refused.map((r) => (
                <li key={r.oid}>
                  "{r.name}" v{r.version} ({r.state || 'library'}) — {REFUSAL_LABEL[r.reason]}
                  {r.reason === 'changed-since-export' && (
                    <span className="block text-xs text-muted-foreground">
                      {changedSinceExportDetail({
                        fileVersion: r.fileVersion ?? r.version,
                        fileState: r.fileState ?? '',
                        version: r.version,
                        state: r.state,
                        effectiveVersionHere: r.effectiveVersionHere,
                      })}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}

        {dangling > 0 && (
          <>
            <p className="text-sm">
              {dangling} element(s) outside the imported bundle reference an OID that was replaced. Their references
              will fail at runtime until fixed.
            </p>

            <ul className="text-sm space-y-1">
              {report.danglingReferences.map((r, i) => (
                <li key={i}>
                  {r.referrerEntityType} "{r.referrerName}" — references {r.brokenReferenceTo}
                </li>
              ))}
            </ul>
          </>
        )}

        <DialogFooter>
          {dangling > 0 && (
            <Button variant="outline" onClick={handleCopyCsv}>
              Copy as CSV
            </Button>
          )}
          <Button onClick={onClose}>Acknowledge</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
