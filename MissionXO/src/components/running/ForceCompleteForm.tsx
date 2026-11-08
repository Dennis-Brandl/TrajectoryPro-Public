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
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button, DialogFooter, Input } from '@mission/ui';
import { runtimeWorkflows } from '@/lib/api/runtime-workflows';
import { useLayout } from '~/lib/layout';
import { reportControlError } from './controls';
import { SheetDialog } from './ConfirmAction';

/** Force complete a waiting gate or repeating script: a reason is required. */
export function ForceCompleteForm({ instanceId, stepInstanceId, stepName, onClose, onDone }: {
  instanceId: string; stepInstanceId: string; stepName: string; onClose: () => void; onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const inflight = useRef(false);
  const size = useLayout() === 'phone' ? 'min-h-12' : 'min-h-11';

  const submit = async () => {
    if (inflight.current || reason.trim().length === 0) return;
    inflight.current = true;
    setBusy(true);
    try {
      await runtimeWorkflows.forceComplete(instanceId, stepInstanceId, reason.trim());
      toast.success(`Forced complete: ${stepName}`);
      onClose();
    } catch (err) {
      reportControlError(err, 'Force complete failed');
    } finally {
      inflight.current = false;
      setBusy(false);
      onDone();
    }
  };

  return (
    <SheetDialog open onClose={onClose} title={`Force complete “${stepName}”?`}
      description="The step is completed without waiting. You will be recorded as the requester.">
      <Input aria-label={`Reason for forcing ${stepName}`} placeholder="Reason (required)" value={reason} maxLength={500}
        className={size} onChange={(e) => setReason(e.target.value)} />
      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" className={size} onClick={onClose}>Cancel</Button>
        <Button type="button" variant="destructive" className={size} disabled={busy || reason.trim().length === 0} onClick={() => void submit()}>
          Force complete
        </Button>
      </DialogFooter>
    </SheetDialog>
  );
}
