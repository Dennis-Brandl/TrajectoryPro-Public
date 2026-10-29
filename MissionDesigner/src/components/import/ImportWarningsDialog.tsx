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

import { AlertTriangle } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@mission/ui'
import { Button } from '@mission/ui'

interface ImportWarningsDialogProps {
  open: boolean
  workflowName: string
  unresolvedProxies: string[]
  onClose: () => void
}

/**
 * Shown after a successful import when some workflow proxy references could not
 * be resolved to existing workflows in the library.
 */
export function ImportWarningsDialog({ open, workflowName, unresolvedProxies, onClose }: ImportWarningsDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import Successful</DialogTitle>
          <DialogDescription>
            &quot;{workflowName}&quot; was imported successfully, but some references could not be resolved.
          </DialogDescription>
        </DialogHeader>

        {unresolvedProxies.length > 0 && (
          <div className="max-h-60 overflow-y-auto rounded-md border p-3">
            {unresolvedProxies.map((proxyName) => (
              <div key={proxyName} className="flex items-center gap-2 py-1">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
                <span className="text-sm">{proxyName}</span>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button onClick={onClose}>Open Workflow</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
