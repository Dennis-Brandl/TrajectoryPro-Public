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

import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@mission/ui'

const APP_NAME = 'Mission Designer'
const APP_TAGLINE = 'Visual workflow specification editor'
const COPYRIGHT = 'Copyright 2026 Dennis L. Brandl. Licensed under the Apache License, Version 2.0.'

interface AboutDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** App version (build-time `__APP_VERSION__`), passed in so the dialog stays pure/testable. */
  version: string
}

/** "About" dialog opened from the app-header icon. Shows name, version, and copyright. */
export function AboutDialog({ open, onOpenChange, version }: AboutDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <img src="/ic_launcher_round.png" alt="" className="h-12 w-12 shrink-0" />
            <div className="text-left">
              <DialogTitle>{APP_NAME}</DialogTitle>
              <DialogDescription>Version {version}</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>{APP_TAGLINE}</p>
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
