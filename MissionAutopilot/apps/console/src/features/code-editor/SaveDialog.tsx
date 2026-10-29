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

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@mission/ui'
import { Button } from '@mission/ui'
import { Input } from '@mission/ui'
import { Label } from '@mission/ui'
import { useSaveCode } from './hooks'

interface SaveDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  actionOid: string
  state: string
  code: string
  onSaved: () => void
}

export default function SaveDialog({
  open,
  onOpenChange,
  actionOid,
  state,
  code,
  onSaved,
}: SaveDialogProps) {
  const [description, setDescription] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const saveMutation = useSaveCode()

  async function handleSave() {
    setErrorMsg(null)
    try {
      await saveMutation.mutateAsync({
        actionOid,
        state,
        code,
        description: description.trim() || undefined,
      })
      setDescription('')
      onOpenChange(false)
      onSaved()
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Save failed')
    }
  }

  function handleOpenChange(open: boolean) {
    if (!open) {
      setDescription('')
      setErrorMsg(null)
    }
    onOpenChange(open)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save Version</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="save-description" className="text-sm">
              Description <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input
              id="save-description"
              placeholder="Describe this version..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !saveMutation.isPending) {
                  void handleSave()
                }
              }}
              autoFocus
            />
          </div>

          {errorMsg && <p className="text-sm text-destructive">{errorMsg}</p>}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleOpenChange(false)}
            disabled={saveMutation.isPending}
          >
            Cancel
          </Button>
          <Button size="sm" onClick={() => void handleSave()} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
