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

import type { RefObject } from 'react'
import { Button } from '../primitives/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../primitives/dialog'

const COPYRIGHT = 'Copyright 2026 Dennis L. Brandl. Licensed under the Apache License, Version 2.0.'

export interface AboutDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  appName: string
  buildVersion: string
  tagline: string
  /** Element that gets focus when the dialog closes (there is no DialogTrigger). */
  returnFocusRef?: RefObject<HTMLElement | null>
}

/** "About" dialog opened from the app-header icon. */
export function AboutDialog({ open, onOpenChange, appName, buildVersion, tagline, returnFocusRef }: AboutDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-sm"
        onCloseAutoFocus={(e) => {
          if (returnFocusRef?.current) {
            e.preventDefault()
            returnFocusRef.current.focus()
          }
        }}
      >
        <DialogHeader>
          <div className="flex items-center gap-3">
            <img src="/ic_launcher_round.png" alt="" className="h-12 w-12 shrink-0" />
            <div className="text-left">
              <DialogTitle>{appName}</DialogTitle>
              <DialogDescription>Version {buildVersion}</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>
            {appName} build {buildVersion}
          </p>
          <p>{tagline}</p>
          <p>{COPYRIGHT}</p>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" size="sm">
              Close
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
