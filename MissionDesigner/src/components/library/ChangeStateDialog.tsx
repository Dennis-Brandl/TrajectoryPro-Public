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

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@mission/ui'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@mission/ui'
import { Input } from '@mission/ui'
import { Label } from '@mission/ui'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@mission/ui'
import { Textarea } from '@mission/ui'
import type { Library, Specification, SpecificationState } from '@/types/library'
import { changeSpecificationState } from '@/lib/api/specification-mutations'
import { editorErrorMessage } from '@/lib/editorErrorMessage'
import { usePrincipal, principalHasRight } from '@/stores/principalStore'
import { SPECIFICATION_STATES, legalTargets, rightForEdge, categoryForEntityType } from '@/lib/lifecycle'

export interface ChangeStateDialogProps {
  spec: Specification
  library: Pick<Library, 'teamId' | 'entityType'>
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: (updated: Specification) => void
}

/** Local-time YYYY-MM-DD (avoids the UTC drift of toISOString near midnight). */
function localDateString(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function ChangeStateDialog({ spec, library, open, onOpenChange, onSuccess }: ChangeStateDialogProps) {
  const principal = usePrincipal()
  const [newState, setNewState] = useState<SpecificationState | ''>('')
  const [reason, setReason] = useState('')
  const [effectiveDate, setEffectiveDate] = useState(localDateString())
  const [submitting, setSubmitting] = useState(false)

  // Admins keep the force-illegal override (design D14): every other state.
  // Members see only legal edges they hold the right for (design §7).
  const targets = useMemo<SpecificationState[]>(() => {
    const from = spec.state
    if (principal?.isAdministrator) return SPECIFICATION_STATES.filter((s) => s !== from)
    return legalTargets(from).filter((to) => {
      if (!principal || library.teamId == null) return false
      const verb = rightForEdge(from, to)
      return (
        verb != null &&
        principalHasRight(principal, library.teamId, `${categoryForEntityType(library.entityType)}:${verb}`)
      )
    })
  }, [spec.state, principal, library])

  const requiresDate = newState === 'Effective'
  const canSubmit =
    newState !== '' && reason.trim().length > 0 && (!requiresDate || effectiveDate !== '') && !submitting

  async function handleSave() {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const effectiveFrom = requiresDate ? new Date(`${effectiveDate}T00:00:00`).getTime() : undefined
      const updated = await changeSpecificationState(spec.id, newState as SpecificationState, reason, effectiveFrom)
      toast.success(`State changed to ${updated.state}`)
      onSuccess?.(updated)
      onOpenChange(false)
      setNewState('')
      setReason('')
    } catch (err) {
      toast.error(editorErrorMessage(err, 'Failed to change state'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Change State — {spec.name} v{spec.version}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="text-sm">
            <span className="text-slate-500">Current state: </span>
            <span className="font-medium">{spec.state}</span>
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-state">New state</Label>
            {targets.length === 0 ? (
              <p className="text-xs text-slate-500 italic">No state changes are available to you for this item.</p>
            ) : (
              <Select value={newState} onValueChange={(v) => setNewState(v as SpecificationState)}>
                <SelectTrigger id="new-state">
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  {targets.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          {requiresDate && (
            <div className="space-y-1">
              <Label htmlFor="effective-date">Effective date (required)</Label>
              <Input
                id="effective-date"
                type="date"
                min={localDateString()}
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
              />
              <p className="text-xs text-slate-500">Today's date takes effect immediately.</p>
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="reason">Reason for change (required)</Label>
            <Textarea id="reason" rows={4} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSubmit}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
