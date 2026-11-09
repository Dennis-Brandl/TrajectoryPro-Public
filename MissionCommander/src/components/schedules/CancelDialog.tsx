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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/** Spec 2026-11-08 §7.2: Cancel needs a confirmation and a reason. */
export function CancelDialog({ label, name, onConfirm, onClose }: {
  label: string; name: string;
  onConfirm: (reason: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const trimmed = reason.trim();
  const submit = async () => {
    setBusy(true);
    try { await onConfirm(trimmed); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Cancel {label} &quot;{name}&quot;</DialogTitle>
          <DialogDescription>
            This prevents the next start and all chains that have not started. Runs already going continue.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="schedule-cancel-reason">Reason</Label>
          <Input id="schedule-cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Back</Button>
          <Button type="button" variant="destructiveOutline" disabled={trimmed === '' || busy} onClick={submit}>
            Cancel Runtime Schedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
