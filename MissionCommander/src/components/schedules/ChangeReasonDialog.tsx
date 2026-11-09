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

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';

const MAX = 2000;

/** Asks why a Master Schedule is being saved. The reason, the time and who saved it go into the
 *  Master's change history, which its Export PDF includes. */
export function ChangeReasonDialog({ version, initial = '', busy, onConfirm, onClose }: {
  /** The version this save makes. */
  version: number;
  initial?: string;
  busy: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState(initial);
  const trimmed = reason.trim();
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save version {version}</DialogTitle>
          <DialogDescription>Say why. The reason is kept in the change history with the time and your name.</DialogDescription>
        </DialogHeader>
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (trimmed) onConfirm(trimmed); }}>
          <Label htmlFor="change-reason">Reason for the change</Label>
          <textarea id="change-reason" autoFocus rows={3} maxLength={MAX} value={reason} onChange={(e) => setReason(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Back to editing</Button>
            <Button type="submit" disabled={busy || trimmed === ''}>Save version {version}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
