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
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { runtimeWorkflows } from '@/lib/api/runtime-workflows';
import { apiErrorMessage } from '@/lib/api/client';
import type { GateTimer } from '@/lib/api/types';
import { useNow } from '@/lib/hooks/useNow';
import { gateTimerText } from './gate-timer-text';

function TimerReadout({ timer }: { timer: GateTimer }) {
  const now = useNow(1000);
  return <span className="text-xs text-muted-foreground">{gateTimerText(timer, now)}</span>;
}

// Spec 2026-10-13 §5.2/§6.4: Force complete a waiting gate or repeating script. Inline (no nested dialog — it lives inside
// the runtime detail dialog and the diagram tooltip): the button opens a required-reason field.
export function ForceCompleteControl({ instanceId, stepInstanceId, stepName, disabled, title, timer, onDone, onSuccess }: {
  instanceId: string; stepInstanceId: string; stepName: string;
  disabled?: boolean; title?: string; timer?: GateTimer;
  /** Runs after every attempt (refresh). */ onDone?: () => void;
  /** Runs only when the force succeeded (e.g. close a tooltip); a failure keeps the typed reason. */ onSuccess?: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const close = () => { setAsking(false); setReason(''); };
  const submit = async () => {
    setBusy(true);
    try {
      await runtimeWorkflows.forceComplete(instanceId, stepInstanceId, reason.trim());
      toast.success(`Forced complete: ${stepName}`);
      close();
      onSuccess?.();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Force complete failed'));
    } finally {
      setBusy(false);
      onDone?.();
    }
  };

  if (!asking) {
    return (
      <Button type="button" variant="ghost" size="sm" aria-label={`Force complete ${stepName}`}
        disabled={disabled} title={title} onClick={() => setAsking(true)}>
        Force complete
      </Button>
    );
  }
  return (
    <span className="flex items-center gap-1">
      {timer && <TimerReadout timer={timer} />}
      <Input aria-label={`Reason for forcing ${stepName}`} placeholder="Reason (required)" value={reason} maxLength={500}
        className="h-7 w-48" onChange={(e) => setReason(e.target.value)} />
      <Button type="button" size="sm" variant="destructive" disabled={disabled || busy || reason.trim().length === 0} onClick={() => void submit()}>
        Confirm
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={close}>Cancel</Button>
    </span>
  );
}
