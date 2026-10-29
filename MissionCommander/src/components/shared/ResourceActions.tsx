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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RequiresTooltip } from '@/components/shared/RequiresTooltip';
import { workCenters } from '@/lib/api/work-centers';
import { runtimeWorkflows } from '@/lib/api/runtime-workflows';
import type { ResourceVerb, ResourceVerbBody, InstanceResourceVerbBody } from '@/lib/api/types';
import type { ResourceTableRow, ResourceWaiterChip } from './ResourceTable';

// Phase 4b (spec §7.3): the operator verbs' UI, shared by the three panes through ResourceTable's
// `actions` prop. Reset / Clear / Cancel confirm inline (the Runtime pane's PendingConfirm strip);
// Release… opens a dialog because it has to CHOOSE — a tracked holder, or an untracked amount /
// pool name. Every control is commander-gated with the Runtime pane's RequiresTooltip + title
// pattern. Only types are imported from ResourceTable, so the two files form no runtime cycle.

export type ResourceVerbArgs = { holderId?: number; waiterId?: number | string; amount?: number; poolName?: string };
export type PendingConfirm =
  | { kind: 'reset' }
  | { kind: 'clear-sync' }
  | { kind: 'cancel-waiter'; waiterId: number | string; label: string; granted: boolean };

export const SYSTEM_COMMANDER_REASON = 'Requires Mission System Commander';

/** One API call per target tier (spec §7.2). An ENVIRONMENT row posts to the WORK-CENTER route
 *  from every pane, the Runtime pane included: through the instance route an environment name
 *  would still act on the whole work-center resource (spec §12.5 item 23), so the pane must not
 *  present it as instance-scoped — routing it here makes the confirm copy honest by construction.
 *  A WORKFLOW row posts to the instance route with the engine key. Bodies are built without
 *  `undefined` keys: the server schemas are `.strict()` and a waiter id's TYPE picks the tier. */
export function resourceVerbCall(row: ResourceTableRow, verb: ResourceVerb, args: ResourceVerbArgs): () => Promise<unknown> {
  const t = row.target;
  if (t.tier === 'environment') {
    const body: ResourceVerbBody = {
      name: t.name,
      ...(args.holderId !== undefined ? { holderId: args.holderId } : {}),
      ...(typeof args.waiterId === 'number' ? { waiterId: args.waiterId } : {}),
      ...(args.amount !== undefined ? { amount: args.amount } : {}),
      ...(args.poolName !== undefined ? { poolName: args.poolName } : {}),
    };
    return () => workCenters.resourceVerb(t.workCenterId, verb, body);
  }
  const body: InstanceResourceVerbBody = {
    resourceKey: t.resourceKey,
    ...(args.holderId !== undefined ? { holderId: args.holderId } : {}),
    ...(args.waiterId !== undefined ? { waiterId: args.waiterId } : {}),
    ...(args.amount !== undefined ? { amount: args.amount } : {}),
    ...(args.poolName !== undefined ? { poolName: args.poolName } : {}),
  };
  return () => runtimeWorkflows.resourceVerb(t.instanceId, verb, body);
}

/** Toast copy is the pane's own (D24) — the engine's summary is support wording. */
export function verbSuccessText(verb: ResourceVerb, name: string): string {
  switch (verb) {
    case 'release-holder': return `Released a hold on “${name}”`;
    case 'release': return `Released untracked capacity on “${name}”`;
    case 'reset': return `Reset “${name}”`;
    case 'cancel-waiter': return `Cancelled a wait on “${name}”`;
    case 'clear-sync': return `Cleared “${name}”`;
  }
}
export function verbFailText(verb: ResourceVerb): string {
  switch (verb) {
    case 'release-holder': case 'release': return 'Release failed';
    case 'reset': return 'Reset failed';
    case 'cancel-waiter': return 'Cancel failed';
    case 'clear-sync': return 'Clear failed';
  }
}

const WC_NOTE = ' This acts on the whole work center, every runtime workflow included.';

function GatedButton({ reason, disabled, label, aria, onClick }: { reason: string | undefined; disabled: boolean; label: string; aria: string; onClick: () => void }) {
  return (
    <RequiresTooltip reason={reason}>
      <Button type="button" variant="ghost" size="sm" aria-label={aria} disabled={disabled} title={reason} onClick={onClick}>{label}</Button>
    </RequiresTooltip>
  );
}

/** D20: one verb per row by type. Release… only when there is something to release. */
export function RowActionButtons({ row, canCommand, busy, onRelease, onConfirm }: {
  row: ResourceTableRow; canCommand: boolean; busy: boolean; onRelease: () => void; onConfirm: (c: PendingConfirm) => void;
}) {
  const reason = canCommand ? undefined : SYSTEM_COMMANDER_REASON;
  const disabled = !canCommand || busy;
  const isSync = row.resourceType === 'sync';
  const isNamed = row.resourceType === 'named pool';
  // A workflow-scoped named pool is excluded here even with inUse > 0: WorkflowResourceView
  // carries only a summary, so the pane cannot name which pool value is held (untrackedNames
  // stays [] for a workflow row) and ReleaseResourceDialog would have nothing to offer but
  // "Nothing to release." Reset remains that row's escape hatch; plumbing held names through
  // the view is a carried item.
  const releasable = !isSync && (
    row.holders.length > 0 || (row.unaccounted ?? 0) > 0 || row.untrackedNames.length > 0 || (row.scope === 'workflow' && row.inUse > 0 && !isNamed)
  );
  return (
    <div className="flex flex-wrap gap-1">
      {releasable && <GatedButton reason={reason} disabled={disabled} label="Release…" aria={`Release ${row.name}`} onClick={onRelease} />}
      {!isSync && <GatedButton reason={reason} disabled={disabled} label="Reset" aria={`Reset ${row.name}`} onClick={() => onConfirm({ kind: 'reset' })} />}
      {isSync && <GatedButton reason={reason} disabled={disabled} label="Clear" aria={`Clear ${row.name}`} onClick={() => onConfirm({ kind: 'clear-sync' })} />}
    </div>
  );
}

export function WaiterCancelButton({ waiter, resourceName, canCommand, busy, onRequest }: {
  waiter: ResourceWaiterChip; resourceName: string; canCommand: boolean; busy: boolean; onRequest: () => void;
}) {
  const reason = canCommand ? undefined : SYSTEM_COMMANDER_REASON;
  return <GatedButton reason={reason} disabled={!canCommand || busy} label="Cancel" aria={`Cancel wait ${waiter.label} on ${resourceName}`} onClick={onRequest} />;
}

export function ConfirmStrip({ row, confirm, busy, onConfirm, onCancel }: {
  row: ResourceTableRow; confirm: PendingConfirm; busy: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  const wcNote = row.scope === 'environment' ? WC_NOTE : '';
  const label = confirm.kind === 'reset'
    ? `Reset “${row.name}” to its initial state? Every holder is dropped and queued waiters are re-granted.${wcNote}`
    : confirm.kind === 'clear-sync'
      ? `Clear every pending Send, Receive and Synchronize on “${row.name}”? Each waiting step fails, catchably.${wcNote}`
      : `Cancel the wait of ${confirm.label} on “${row.name}”? That step fails, catchably.${confirm.granted ? ' Its reserved capacity is returned.' : ''}`;
  return (
    <div className="flex items-center gap-2 rounded border border-destructive/40 bg-destructive/10 p-2 text-sm">
      <span>{label}</span>
      <Button type="button" variant="destructive" size="sm" disabled={busy} onClick={onConfirm}>Confirm</Button>
      <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
    </div>
  );
}

/** Release… (spec §7.3): choose a tracked holder (→ release-holder), or an untracked amount /
 *  pool name (→ release). The click IS the deliberate act — no second confirm, matching
 *  AssignClaimDialog. Copy per spec §12.5 item 16: the engine subtracts reserved grants from the
 *  unaccounted figure the chip shows, so it may allow fewer than offered here. */
export function ReleaseResourceDialog({ row, busy, onRelease, onClose }: {
  row: ResourceTableRow; busy: boolean; onRelease: (args: ResourceVerbArgs) => void; onClose: () => void;
}) {
  const [amount, setAmount] = useState(1);
  const isNamed = row.resourceType === 'named pool';
  const isEnv = row.scope === 'environment';
  // A workflow-scoped pool tracks no holders, so its whole in_use is "untracked" by definition.
  const untrackedUnits = isEnv ? (row.unaccounted ?? 0) : row.inUse;
  const amountOk = Number.isInteger(amount) && amount >= 1 && amount <= untrackedUnits;
  const nothing = row.holders.length === 0 && (isNamed ? row.untrackedNames.length === 0 : untrackedUnits === 0);
  const btn = 'justify-start';
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Release “{row.name}”</DialogTitle>
          <DialogDescription>
            {isEnv
              ? 'Frees a hold on the shared work-center resource; the next waiter in line is granted at once.'
              : 'Frees capacity on this runtime workflow’s own pool.'}
          </DialogDescription>
        </DialogHeader>
        {row.holders.length > 0 && (
          <section className="space-y-1">
            <h4 className="text-xs font-semibold uppercase text-muted-foreground">Tracked holders</h4>
            <div className="flex flex-col gap-1">
              {row.holders.map((h) => (
                <Button key={h.key} type="button" variant="ghost" size="sm" className={btn} disabled={busy || h.holderId === null}
                  aria-label={`Release holder ${h.label}`} onClick={() => { if (h.holderId !== null) onRelease({ holderId: h.holderId }); }}>
                  {h.label}
                </Button>
              ))}
            </div>
          </section>
        )}
        {isNamed && row.untrackedNames.length > 0 && (
          <section className="space-y-1">
            <h4 className="text-xs font-semibold uppercase text-muted-foreground">Untracked names</h4>
            <p className="text-xs text-muted-foreground">Held on the roster with no runtime workflow recorded as the holder.</p>
            <div className="flex flex-col gap-1">
              {row.untrackedNames.map((n) => (
                <Button key={n} type="button" variant="ghost" size="sm" className={btn} disabled={busy}
                  aria-label={`Release untracked name ${n}`} onClick={() => onRelease({ poolName: n })}>
                  {n}
                </Button>
              ))}
            </div>
          </section>
        )}
        {!isNamed && untrackedUnits > 0 && (
          <section className="space-y-1">
            <h4 className="text-xs font-semibold uppercase text-muted-foreground">Untracked units</h4>
            <p className="text-xs text-muted-foreground">
              {isEnv
                ? `${untrackedUnits} unit(s) are in use with no recorded holder. Units reserved for a granted-but-unconsumed waiter are not releasable, so the engine may allow fewer than this.`
                : `${untrackedUnits} unit(s) in use.`}
            </p>
            <div className="flex items-center gap-2">
              <Label htmlFor="release-amount">Amount</Label>
              {/* value guards against NaN (an empty field): a raw NaN passed to a controlled
                  number input's `value` prop makes React warn ("Received NaN for the `value`
                  attribute") even though the browser itself just leaves the field blank; the
                  guard keeps the DOM value in sync with what's rendered with no warning. State
                  stays the real NaN, which `amountOk` already handles via Number.isInteger. */}
              <Input id="release-amount" type="number" min={1} max={untrackedUnits} className="w-24" value={Number.isNaN(amount) ? '' : amount}
                onChange={(e) => setAmount(e.target.valueAsNumber)} />
              <Button type="button" size="sm" disabled={busy || !amountOk} aria-label="Release untracked units" onClick={() => onRelease({ amount })}>
                Release {amountOk ? amount : ''}
              </Button>
            </div>
          </section>
        )}
        {nothing && <p className="text-sm text-muted-foreground">Nothing to release.</p>}
      </DialogContent>
    </Dialog>
  );
}
