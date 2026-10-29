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

import { useMemo } from 'react'
import { toast } from 'sonner'
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@mission/ui'
import { useFlowStore } from '@/stores/flowStore'
import { useCanEditActiveSpec } from '@/hooks/useCanEditActiveSpec'
import { FormButtonProblems } from './inspector/FormButtonProblems'
import { generateOID, WORKER_INTERNAL } from '@/lib/snowflake'
import { planWorkflowButtonConversion } from '@/lib/form-document/convert-workflow-buttons'

/**
 * Workflow-wide "Convert buttons in all forms". The plan is computed when the dialog opens;
 * Apply writes every changed form through one bulk flow-store update.
 */
export function ConvertButtonsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const updateNodesData = useFlowStore((s) => s.updateNodesData)
  const canEdit = useCanEditActiveSpec()
  const plan = useMemo(
    () => (open ? planWorkflowButtonConversion(useFlowStore.getState().nodes, () => generateOID(WORKER_INTERNAL)) : []),
    [open],
  )

  const apply = () => {
    if (!canEdit) return
    updateNodesData(plan.map((p) => ({ id: p.nodeId, data: { formDocument: p.result.document } })))
    toast.success(`Converted buttons in ${plan.length} form(s).`)
    onClose()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose()
      }}
    >
      <DialogContent className="max-w-lg" onKeyDown={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Convert buttons in all forms</DialogTitle>
          <DialogDescription>
            {plan.length === 0
              ? 'Nothing needs converting.'
              : 'These forms will get their own buttons. You can undo this with Ctrl+Z on the canvas.'}
          </DialogDescription>
        </DialogHeader>
        {plan.length === 0 ? (
          <p className="text-sm">All forms already use their own buttons.</p>
        ) : (
          <ul className="space-y-3 max-h-[50vh] overflow-y-auto text-sm">
            {plan.map((p) => (
              <li key={p.nodeId}>
                <div className="font-medium">{p.nodeName}</div>
                <ul className="list-disc pl-5">
                  {p.result.changes.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
                <FormButtonProblems messages={p.result.problems.map((q) => q.message)} />
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          {plan.length === 0 ? (
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={apply} disabled={!canEdit}>
                Apply
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
