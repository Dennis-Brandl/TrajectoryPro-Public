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

import { useEffect, useState } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import VersionHistory from './VersionHistory'
import { api } from '@/lib/api'
import type { CodeVersion } from '@/lib/types'

interface StateHistorySheetProps {
  actionOid: string
  /** State whose history to show; null keeps the sheet closed */
  state: string | null
  onClose: () => void
}

/**
 * Read-only Version History sheet reachable from the action detail page —
 * browse a state's saved versions and view any version's source without
 * entering the code editor. Activate/Delete stay editor-only.
 */
export default function StateHistorySheet({ actionOid, state, onClose }: StateHistorySheetProps) {
  const [viewing, setViewing] = useState<CodeVersion | null>(null)

  // Selected code belongs to one (action, state) — drop it when the target changes
  useEffect(() => {
    setViewing(null)
  }, [actionOid, state])

  async function handleSelectVersion(versionId: string) {
    if (!state) return
    try {
      const version = await api.codeVersion(actionOid, state, versionId)
      setViewing(version)
    } catch {
      // version fetch errors are rare; fail silently (matches the editor)
    }
  }

  return (
    <Sheet open={state !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-[480px] sm:max-w-[560px] flex flex-col">
        <SheetHeader>
          <SheetTitle>Version History — {state}</SheetTitle>
        </SheetHeader>
        <div className="px-4 pb-4 flex-1 min-h-0 flex flex-col gap-3 overflow-hidden">
          <div className="shrink-0 overflow-y-auto">
            {state !== null && (
              <VersionHistory
                actionOid={actionOid}
                state={state}
                activeVersionId={viewing?.id ?? null}
                onSelectVersion={(id) => void handleSelectVersion(id)}
                readOnly
              />
            )}
          </div>
          {viewing && (
            <div className="flex-1 min-h-0 flex flex-col border rounded">
              <div className="px-2 py-1 border-b bg-muted/40 text-xs text-muted-foreground shrink-0">
                v{viewing.version_number} source (read-only)
              </div>
              <pre className="flex-1 min-h-0 overflow-auto p-2 text-xs font-mono whitespace-pre">
                {viewing.source_code}
              </pre>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
