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
import { Fragment, useState } from 'react';
import { useSelectionStore } from '@/stores/selectionStore';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ResourceVerb, SharedResourceView, WorkflowResourceView } from '@/lib/api/types';
import { ConfirmStrip, ReleaseResourceDialog, RowActionButtons, WaiterCancelButton, type PendingConfirm, type ResourceVerbArgs } from './ResourceActions';

// One table for all three panes (spec §6.3-6.5): Name · Type · State · Held by · Waiting ·
// Defined by · Actions (Phase 4b, spec §12.4 item 3 — a column, not a second table). Rows are a
// DISPLAY shape the callers build with the two converters below, so the table knows nothing about
// where a row came from — a workflow-scoped pool projected out of engine_state and a registry
// row render through the same columns. `target` is the one field that is NOT display: it is what
// a verb must name (spec §7.1) and ResourceActions.resourceVerbCall routes on it. Without the
// `actions` prop the table is the Phase 3 read-only table, unchanged.

export type ResourceChip = { key: string; label: string; instanceId: string | null };
/** `holderId` is the wc_resource_holder row id (D18) — null on a workflow-scoped row, whose
 *  local manager tracks no holders (its counters ARE the state; resources.ts MODEL note). */
export type ResourceHolderChip = ResourceChip & { holderId: number | null; amount: number; heldName: string | null };
/** `waiterId`: the waiter ROW id (environment) or the queued STEP oid (workflow) — D16's rule. */
export type ResourceWaiterChip = ResourceChip & { waiterId: number | string; granted: boolean };
export type ResourceTarget =
  | { tier: 'environment'; workCenterId: string; name: string }
  | { tier: 'workflow'; instanceId: string; resourceKey: string };
export type ResourceTableRow = {
  key: string; scope: 'workflow' | 'environment';
  name: string; resourceType: string; state: string;
  holders: ResourceHolderChip[]; waiters: ResourceWaiterChip[];
  unaccounted: number | null;
  /** Named pool only: roster names currently held that no holder row claims — what an untracked
   *  `release` (poolName) gives back. Empty for every other type. */
  untrackedNames: string[];
  inUse: number;
  ledgerMismatch: boolean; overCommitted: boolean;
  definedBy: { envSpecId: string | null; label: string } | null; orphaned: boolean;
  target: ResourceTarget;
};
export type ResourceActionHandlers = {
  canCommand: boolean; busy: boolean;
  onVerb: (row: ResourceTableRow, verb: ResourceVerb, args: ResourceVerbArgs) => void;
};

const join = (parts: Array<string | null | undefined | false>) => parts.filter(Boolean).join(' · ');

/** `MIX-20261007-001 (2)`, `MIX-20261007-002 · Mix Step`, `MIX-20261007-003 · BayA · Load` —
 *  spec §6.3's chip forms, rendered from each row's configured runtimeLabel. */
export function toSharedResourceRow(v: SharedResourceView): ResourceTableRow {
  const claimedNames = new Set(v.holders.map((h) => h.heldName).filter((n): n is string => n !== null));
  return {
    key: `env:${v.name}`, scope: 'environment', name: v.name, resourceType: v.resourceType, state: v.summary.state,
    holders: v.holders.map((h, i) => ({
      key: `${h.instanceId}:${h.stepOid}:${i}`, instanceId: h.instanceId, holderId: h.id, amount: h.amount, heldName: h.heldName,
      label: join([h.runtimeLabel + (h.amount > 1 ? ` (${h.amount})` : ''), h.heldName, h.stepName]),
    })),
    // FIFO order is the server's order; a granted waiter is a handoff its instance has not yet consumed.
    waiters: v.waiters.map((w) => ({
      key: String(w.id), instanceId: w.instanceId, waiterId: w.id, granted: w.granted,
      label: join([w.runtimeLabel, w.stepName, w.kind === 'acquire' ? (w.amount !== null && w.amount > 1 ? `×${w.amount}` : null) : w.kind, w.granted && 'granted']),
    })),
    unaccounted: v.unaccounted,
    // Same rule as the DAO's accountFor: held = on the roster and not free; untracked = held and unclaimed.
    untrackedNames: v.resourceType === 'named pool' ? v.poolNames.filter((n) => !v.availableNames.includes(n) && !claimedNames.has(n)) : [],
    inUse: v.inUse,
    ledgerMismatch: v.ledgerMismatch, overCommitted: v.overCommitted,
    // The label survives orphaning — the DAO keeps defined_from_* text for an orphaned row
    // (spec §6.4's backstop needs to name the deleted spec); only the link target goes away.
    definedBy: { envSpecId: v.orphaned ? null : v.definedBy.envSpecId, label: `${v.definedBy.name ?? 'unknown spec'} v${v.definedBy.version ?? '?'} (${v.definedBy.state ?? '?'})` },
    orphaned: v.orphaned,
    target: { tier: 'environment', workCenterId: v.workCenterId, name: v.name },
  };
}

/** A workflow-scoped pool from engine_state: the instance manager tracks no holders (its
 *  counters ARE the state column), and it has no provenance — its owner is the workflow itself. */
export function toWorkflowResourceRow(v: WorkflowResourceView, instance: { id: string; runtimeNumber: number; runtimeLabel: string }): ResourceTableRow {
  return {
    key: `wf:${v.key}`, scope: 'workflow', name: v.name, resourceType: v.resourceType, state: v.summary.state,
    holders: [],
    waiters: v.queuedSteps.map((q, i) => ({
      key: `${q.stepOid}:${i}`, instanceId: instance.id, waiterId: q.stepOid, granted: false,
      label: join([instance.runtimeLabel, q.stepName ?? q.stepOid, q.kind !== 'acquire' && q.kind]),
    })),
    unaccounted: null, untrackedNames: [], inUse: v.summary.inUse,
    ledgerMismatch: false, overCommitted: false,
    definedBy: null, orphaned: false,
    target: { tier: 'workflow', instanceId: instance.id, resourceKey: v.key },
  };
}

// Same tiny uppercase-pill shape as StateBadge / RuntimeStatusBadge.
const BADGE = 'shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase';
const MUTED = `${BADGE} bg-muted text-muted-foreground`;
const ATTENTION = `${BADGE} bg-accent text-accent-foreground`;
const ALARM = `${BADGE} bg-destructive/15 text-destructive`;

function Chip({ chip, onOpen }: { chip: ResourceChip; onOpen: (instanceId: string) => void }) {
  const cls = 'rounded border px-1.5 py-0.5 text-xs';
  if (!chip.instanceId) return <span className={cls}>{chip.label}</span>;
  const id = chip.instanceId;
  return (
    <button type="button" className={`${cls} underline-offset-2 hover:underline`} onClick={() => onOpen(id)}>
      {chip.label}
    </button>
  );
}

type RowViewProps = {
  row: ResourceTableRow; showScope: boolean; showProvenance: boolean; columns: number;
  actions: ResourceActionHandlers | undefined;
  openInstance: (id: string) => void; openEnvironment: (id: string) => void;
};

/** One row plus, while a verb is pending, its inline confirm strip beneath it and the Release
 *  dialog. Per-row state so two rows never share a confirm; the server 409 stays the backstop
 *  for a confirm captured against a picture the next poll changed (RuntimeDetailDialog's rule). */
function ResourceRowView({ row: r, showScope, showProvenance, columns, actions, openInstance, openEnvironment }: RowViewProps) {
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const fire = (verb: ResourceVerb, args: ResourceVerbArgs) => {
    setConfirm(null); setReleaseOpen(false);
    actions?.onVerb(r, verb, args);
  };
  return (
    <Fragment>
      <TableRow>
        <TableCell>
          <span className="font-medium">{r.name}</span>
          {showScope && <span className={`ml-2 ${MUTED}`}>{r.scope}</span>}
        </TableCell>
        <TableCell className="text-muted-foreground">{r.resourceType}</TableCell>
        <TableCell>
          <span>{r.state}</span>
          {r.overCommitted && (
            <span className={`ml-2 ${ALARM}`} title="in_use exceeds capacity (use_limit lowered below the live in_use, or an over-counted pool); no new acquire succeeds until it drains">over-committed</span>
          )}
          {r.ledgerMismatch && (
            <span className={`ml-2 ${ALARM}`} title="The holder ledger claims more than the counters show">ledger mismatch</span>
          )}
        </TableCell>
        <TableCell>
          <div className="flex flex-wrap items-center gap-1">
            {r.holders.map((h) => <Chip key={h.key} chip={h} onOpen={openInstance} />)}
            {r.unaccounted !== null && r.unaccounted > 0 && (
              <span className={ATTENTION} title="Held, but no runtime workflow is recorded as the holder">unaccounted {r.unaccounted}</span>
            )}
            {r.holders.length === 0 && !(r.unaccounted !== null && r.unaccounted > 0) && <span className="text-muted-foreground">—</span>}
          </div>
        </TableCell>
        <TableCell>
          {r.waiters.length === 0 ? <span className="text-muted-foreground">—</span> : (
            <ol className="flex flex-wrap items-center gap-1">
              {r.waiters.map((w) => (
                <li key={w.key} className="flex items-center gap-1">
                  <Chip chip={w} onOpen={openInstance} />
                  {actions && (
                    <WaiterCancelButton waiter={w} resourceName={r.name} canCommand={actions.canCommand} busy={actions.busy}
                      onRequest={() => setConfirm({ kind: 'cancel-waiter', waiterId: w.waiterId, label: w.label, granted: w.granted })} />
                  )}
                </li>
              ))}
            </ol>
          )}
        </TableCell>
        {showProvenance && (
          <TableCell>
            {r.definedBy === null ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              <>
                {r.definedBy.envSpecId ? (
                  <button type="button" className="text-left underline-offset-2 hover:underline"
                    onClick={() => openEnvironment(r.definedBy!.envSpecId!)}>
                    {r.definedBy.label}
                  </button>
                ) : (
                  <span>{r.definedBy.label}</span>
                )}
                {r.orphaned && (
                  <span className={`ml-2 ${MUTED}`} title="The declaring environment spec was deleted; the pool outlived it">orphaned</span>
                )}
              </>
            )}
          </TableCell>
        )}
        {actions && (
          <TableCell>
            <RowActionButtons row={r} canCommand={actions.canCommand} busy={actions.busy}
              onRelease={() => setReleaseOpen(true)} onConfirm={setConfirm} />
          </TableCell>
        )}
      </TableRow>
      {actions && confirm && (
        <TableRow>
          <TableCell colSpan={columns}>
            <ConfirmStrip row={r} confirm={confirm} busy={actions.busy}
              onConfirm={() => fire(confirm.kind, confirm.kind === 'cancel-waiter' ? { waiterId: confirm.waiterId } : {})}
              onCancel={() => setConfirm(null)} />
          </TableCell>
        </TableRow>
      )}
      {actions && releaseOpen && (
        <ReleaseResourceDialog row={r} busy={actions.busy}
          onRelease={(args) => fire(args.holderId !== undefined ? 'release-holder' : 'release', args)}
          onClose={() => setReleaseOpen(false)} />
      )}
    </Fragment>
  );
}

export function ResourceTable({ rows, emptyText, showScope = false, showProvenance = true, actions }:
  { rows: ResourceTableRow[]; emptyText: string; showScope?: boolean; showProvenance?: boolean; actions?: ResourceActionHandlers }) {
  const setHierarchy = useSelectionStore((s) => s.setHierarchy);
  const selectRuntimeWorkflow = useSelectionStore((s) => s.selectRuntimeWorkflow);
  const selectEnvironment = useSelectionStore((s) => s.selectEnvironment);
  // Two-call navigation, always setHierarchy THEN select — the app's standing pattern.
  const openInstance = (id: string) => { setHierarchy('runtime'); selectRuntimeWorkflow(id); };
  const openEnvironment = (id: string) => { setHierarchy('environment'); selectEnvironment(id); };
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  const columns = 5 + (showProvenance ? 1 : 0) + (actions ? 1 : 0);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>State</TableHead>
          <TableHead>Held by</TableHead>
          <TableHead>Waiting</TableHead>
          {showProvenance && <TableHead>Defined by</TableHead>}
          {actions && <TableHead>Actions</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <ResourceRowView key={r.key} row={r} showScope={showScope} showProvenance={showProvenance} columns={columns}
            actions={actions} openInstance={openInstance} openEnvironment={openEnvironment} />
        ))}
      </TableBody>
    </Table>
  );
}
