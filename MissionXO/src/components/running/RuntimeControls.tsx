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
import { MoreHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, cn } from '@mission/ui';
import { runtimeWorkflows } from '@/lib/api/runtime-workflows';
import type { RuntimeWorkflowLiveDetail } from '@/lib/api/types';
import type { WcMode } from '~/lib/access';
import { useLayout } from '~/lib/layout';
import { ConfirmAction } from './ConfirmAction';
import { CONFIRM_VERBS, availableVerbs, reportControlError, type Verb } from './controls';

const REQUESTER = 'You will be recorded as the requester.';

const COPY: Partial<Record<Verb, { title: string; body: string; confirm: string }>> = {
  stop: { title: 'Stop this runtime?', body: `The runtime stops after its current work. ${REQUESTER}`, confirm: 'Stop runtime' },
  abort: { title: 'Abort this runtime?', body: `The runtime is aborted and cannot be resumed. ${REQUESTER}`, confirm: 'Abort runtime' },
  stopNow: { title: 'Stop now?', body: `Skip the cleanup and stop now. The cleanup steps will be halted. ${REQUESTER}`, confirm: 'Stop now' },
  abortNow: { title: 'Abort now?', body: `Skip the cleanup and abort now. The cleanup steps will be halted. ${REQUESTER}`, confirm: 'Abort now' },
  delete: { title: 'Delete this runtime?', body: 'The runtime is removed from the work center.', confirm: 'Delete runtime' },
};
const DONE: Record<Verb, string> = {
  start: 'starting', pause: 'pausing', resume: 'resuming', stop: 'stopping', abort: 'aborting',
  stopNow: 'stopping', abortNow: 'aborting', delete: 'deleted',
};
const FAIL: Record<Verb, string> = {
  start: 'Start failed', pause: 'Pause failed', resume: 'Resume failed', stop: 'Stop failed', abort: 'Abort failed',
  stopNow: 'Skip cleanup failed', abortNow: 'Skip cleanup failed', delete: 'Delete failed',
};

function call(verb: Verb, id: string): Promise<unknown> {
  switch (verb) {
    case 'start': return runtimeWorkflows.start(id);
    case 'pause': return runtimeWorkflows.pause(id);
    case 'resume': return runtimeWorkflows.resume(id);
    case 'stop': return runtimeWorkflows.stop(id);
    case 'abort': return runtimeWorkflows.abort(id);
    case 'stopNow': return runtimeWorkflows.skipCleanup(id, 'stop');
    case 'abortNow': return runtimeWorkflows.skipCleanup(id, 'abort');
    case 'delete': return runtimeWorkflows.remove(id);
  }
}

/** Pause/Resume/Start, Stop and Abort… on the main bar; Stop now, Abort now and Delete in "More"
 *  only when available. `bar` is the phone's sticky bottom bar. */
export function RuntimeControls({ detail, mode, offline, onChanged, onDeleted, bar = false }: {
  detail: RuntimeWorkflowLiveDetail; mode: WcMode; offline: boolean;
  onChanged: () => void; onDeleted: () => void; bar?: boolean;
}) {
  const phone = useLayout() === 'phone';
  const [confirm, setConfirm] = useState<Verb | null>(null);
  const [busy, setBusy] = useState(false);
  const inflight = useRef(false);
  const can = availableVerbs(detail, mode, offline);
  const id = detail.summary.id;
  const label = detail.summary.runtimeLabel;

  const run = async (verb: Verb) => {
    if (inflight.current) return; // one request per tap
    inflight.current = true;
    setBusy(true);
    setConfirm(null);
    try {
      await call(verb, id);
      toast.success(`${label} ${DONE[verb]}`);
      if (verb === 'delete') onDeleted(); else onChanged();
    } catch (err) {
      reportControlError(err, FAIL[verb]);
      onChanged();
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  };
  const ask = (verb: Verb) => { if (CONFIRM_VERBS.has(verb)) setConfirm(verb); else void run(verb); };

  const first: Verb = can.start ? 'start' : can.resume ? 'resume' : 'pause';
  const firstLabel = first === 'start' ? 'Start' : first === 'resume' ? 'Resume' : 'Pause';
  const size = bar ? 'min-h-12 flex-1' : phone ? 'min-h-12' : 'min-h-11';
  const more = (['stopNow', 'abortNow', 'delete'] as const).filter((v) => can[v]);
  const copy = confirm ? COPY[confirm] : undefined;

  return (
    <div
      className={cn(
        'flex items-center gap-2',
        bar && 'sticky bottom-0 border-t border-border bg-background px-4 py-2',
      )}
    >
      <Button type="button" variant="outline" className={size} disabled={!can[first] || busy} onClick={() => ask(first)}>{firstLabel}</Button>
      <Button type="button" variant="outline" className={size} disabled={!can.stop || busy} onClick={() => ask('stop')}>Stop</Button>
      <Button type="button" variant="destructive" className={size} disabled={!can.abort || busy} onClick={() => ask('abort')}>Abort…</Button>
      {more.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" aria-label="More" className={bar ? 'min-h-12' : 'min-h-11'} disabled={busy}>
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {more.map((v) => (
              <DropdownMenuItem key={v} onSelect={() => ask(v)}>
                {v === 'stopNow' ? 'Stop now' : v === 'abortNow' ? 'Abort now' : 'Delete'}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <ConfirmAction
        open={confirm !== null && copy !== undefined}
        title={copy?.title ?? ''} body={copy?.body ?? ''} confirmLabel={copy?.confirm ?? ''}
        busy={busy} onConfirm={() => { if (confirm) void run(confirm); }} onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
