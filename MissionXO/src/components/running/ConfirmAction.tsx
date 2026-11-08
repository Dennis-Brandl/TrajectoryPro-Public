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
import type { ReactNode } from 'react';
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, cn } from '@mission/ui';
import { useLayout } from '~/lib/layout';

/** A dialog on desktop and tablet; on a phone the same dialog anchored to the bottom, full width. */
export function SheetDialog({ open, onClose, title, description, className, children }: {
  open: boolean; onClose: () => void; title: string; description?: string; className?: string; children: ReactNode;
}) {
  const phone = useLayout() === 'phone';
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        className={cn(
          phone && 'bottom-0 left-0 top-auto w-full max-w-none translate-x-0 translate-y-0 rounded-b-none rounded-t-xl',
          className,
        )}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className={description ? undefined : 'sr-only'}>{description ?? title}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

export function ConfirmAction({ open, title, body, confirmLabel, destructive = true, busy, onConfirm, onCancel }: {
  open: boolean; title: string; body: string; confirmLabel: string; destructive?: boolean; busy: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  const phone = useLayout() === 'phone';
  const size = phone ? 'min-h-12' : 'min-h-11';
  return (
    <SheetDialog open={open} onClose={onCancel} title={title} description={body}>
      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" className={size} onClick={onCancel}>Cancel</Button>
        <Button type="button" variant={destructive ? 'destructive' : 'default'} className={size} disabled={busy} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </DialogFooter>
    </SheetDialog>
  );
}
