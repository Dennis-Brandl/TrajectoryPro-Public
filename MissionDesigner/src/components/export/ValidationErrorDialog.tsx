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

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@mission/ui'
import { Button } from '@mission/ui'
import { AlertTriangle } from 'lucide-react'
import type { ValidationError } from '@/lib/export/workflow-validation'

interface ValidationErrorDialogProps {
  open: boolean
  onClose: () => void
  errors: ValidationError[]
}

export function ValidationErrorDialog({ open, onClose, errors }: ValidationErrorDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Workflow Validation Errors
          </DialogTitle>
        </DialogHeader>
        <div className="overflow-y-auto flex-1 space-y-2 py-2">
          {errors.map((error, i) => (
            <div
              key={i}
              className="flex gap-2 p-2 rounded border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-sm"
            >
              <div className="flex-1">
                {error.workflowName && (
                  <span className="text-xs font-semibold text-blue-600 dark:text-blue-400 mr-1">
                    [{error.workflowName}]
                  </span>
                )}
                {error.nodeName && <span className="font-medium">{error.nodeName}</span>}
                {error.nodeName && error.nodeType && (
                  <span className="text-slate-500 dark:text-slate-400 ml-1">({error.nodeType})</span>
                )}
                {(error.nodeName || error.nodeType) && <span className="mx-1">&mdash;</span>}
                <span>{error.message}</span>
              </div>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>OK</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
