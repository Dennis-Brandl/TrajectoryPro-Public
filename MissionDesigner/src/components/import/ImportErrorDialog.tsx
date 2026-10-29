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

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@mission/ui'
import { Button } from '@mission/ui'

interface ImportErrorDialogProps {
  open: boolean
  errorMessage: string
  onClose: () => void
}

/**
 * Shown when a workflow ZIP package cannot be imported due to a malformed or
 * invalid file. Displays the error message so the user can diagnose the issue.
 */
export function ImportErrorDialog({ open, errorMessage, onClose }: ImportErrorDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import Failed</DialogTitle>
          <DialogDescription>The workflow package could not be imported.</DialogDescription>
        </DialogHeader>

        <pre className="whitespace-pre-wrap rounded bg-muted p-3 text-sm">{errorMessage}</pre>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
