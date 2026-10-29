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

import { Button } from '@mission/ui'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@mission/ui'
import type { VersionHistoryEntry } from '@/types/version'

interface VersionHistoryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  history: VersionHistoryEntry[]
  title?: string
}

export function VersionHistoryDialog({ open, onOpenChange, history, title }: VersionHistoryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{title || 'Version History'}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto">
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No version history</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white dark:bg-slate-950">
                <tr className="border-b text-left">
                  <th className="py-2 pr-3 font-medium">Version</th>
                  <th className="py-2 pr-3 font-medium">Date</th>
                  <th className="py-2 pr-3 font-medium">Account</th>
                  <th className="py-2 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody>
                {history.map((entry, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-2 pr-3 font-mono">{entry.version}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {new Date(entry.date).toLocaleDateString(undefined, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="py-2 pr-3">{entry.account}</td>
                    <td className="py-2 text-muted-foreground">{entry.reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
