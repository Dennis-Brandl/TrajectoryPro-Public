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
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { runtimeHistory } from '@/lib/api/runtime-history';
import { apiErrorMessage } from '@/lib/api/client';

// Sentinel for the unscoped option — Radix Select forbids an empty item value, mirroring
// WorkCenterSelect's ROOT_VALUE / DispatchPolicySelect's INHERIT_VALUE pattern. Purge has no
// orphans option (unlike HistoryPage's cross-WC filter): the server's purgeBody schema is
// `{ olderThan, workCenterId? }` only — orphaned rows are always included in an unscoped purge
// and can never be targeted on their own.
const ALL_VALUE = '__all__';

// Debounce window for the count-preview fetch (ticket 3): a keystroke-driven date field or a
// scope re-pick fires this effect on every intermediate value, not just the settled one.
const COUNT_PREVIEW_DEBOUNCE_MS = 300;

// Ticket 1 (pluralization): one helper for all three "N history entries" surfaces below
// (preview text, confirm label, success toast) so they can't drift from each other.
const entryCount = (n: number) => `${n} history ${n === 1 ? 'entry' : 'entries'}`;

/**
 * Admin-only destructive purge (phase 7 Task 8). Opened from HistoryPage's Purge control (the
 * server route itself is `requireAdministrator`, so exposure there is the real gate — this
 * dialog is reachable only once that control is visible). The dialog IS the confirmation: one
 * destructive action button whose own label states exactly what committing it will do, plus a
 * live count preview so an admin never purges blind. Cancel is a distinct control that only
 * ever closes — it can never reach `runtimeHistory.purge`.
 *
 * p7 sweep ticket 4b: `workCenters` is a prop, not a self-fetch — `HistoryPage` (the dialog's
 * only mount point) already holds the work-center list for its own scope dropdown, so this
 * dialog reuses that single fetch instead of issuing a second, redundant `workCenters.list()`.
 */
export function PurgeDialog({ workCenters, onClose, onPurged }: {
  workCenters: Array<{ id: string; name: string }>;
  onClose: () => void;
  onPurged: () => void;
}) {
  const [olderThan, setOlderThan] = useState('');
  const [scope, setScope] = useState(ALL_VALUE);
  const [count, setCount] = useState<number | null>(null);
  const [countLoading, setCountLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const workCenterId = scope === ALL_VALUE ? undefined : scope;

  // Re-previews on every date OR scope commit (contract: "fetch purgeCount when the
  // date/scope commit"). An empty date is not a query worth sending — `count` just resets to
  // null instead, which also collapses the preview text and the confirm button's disabled
  // state falls back to the "bad date" branch below.
  //
  // Ticket 3 (debounce): a non-empty change doesn't fetch immediately — it waits
  // COUNT_PREVIEW_DEBOUNCE_MS after the LAST olderThan/workCenterId change, so three rapid
  // edits (e.g. someone typing the date field) collapse into one `purgeCount` call instead of
  // three. `countLoading` still flips true synchronously on every change (not just once the
  // debounce settles), so the confirm button — gated on `countLoading || count === null` —
  // stays disabled for the WHOLE debounce window, not just while the fetch itself is in
  // flight; a stale `count` from a previous commit can never leak through as a trustworthy
  // preview while a newer, not-yet-fetched value is pending.
  useEffect(() => {
    if (olderThan === '') {
      setCount(null);
      setCountLoading(false);
      return;
    }
    let cancelled = false;
    setCountLoading(true);
    const timer = setTimeout(() => {
      runtimeHistory.purgeCount({ olderThan, workCenterId })
        .then((res) => { if (!cancelled) setCount(res.count); })
        .catch((err) => {
          if (cancelled) return;
          setCount(null);
          toast.error(apiErrorMessage(err, 'Failed to preview purge count'));
        })
        .finally(() => { if (!cancelled) setCountLoading(false); });
    }, COUNT_PREVIEW_DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [olderThan, workCenterId]);

  const handlePurge = async () => {
    setBusy(true);
    try {
      const res = await runtimeHistory.purge({ olderThan, workCenterId });
      toast.success(`${entryCount(res.deleted)} deleted`);
      onPurged();
      onClose();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Purge failed'));
    } finally {
      setBusy(false);
    }
  };

  // count === null covers BOTH "no date yet" and "the last purgeCount call failed" — the
  // live-count preview is a safety mechanism, so a failed preview must re-arm the same
  // guard a missing date does, not silently fall back to "0" while the real count is
  // unknown. Only a fresh, successfully-loaded count re-enables the confirm.
  const confirmDisabled = olderThan === '' || busy || countLoading || count === null;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Purge history</DialogTitle>
          <DialogDescription>
            Permanently delete history entries older than a cutoff date. This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1">
          <Label htmlFor="purge-older-than">Older than</Label>
          <Input
            id="purge-older-than" type="datetime-local" required aria-label="Older than"
            value={olderThan} onChange={(e) => setOlderThan(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="purge-scope">Work center</Label>
          <Select value={scope} onValueChange={setScope}>
            <SelectTrigger id="purge-scope" className="w-full" aria-label="Work center scope">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>All work centers</SelectItem>
              {workCenters.map((wc) => <SelectItem key={wc.id} value={wc.id}>{wc.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {count !== null && (
          <p className="text-sm text-muted-foreground">
            {entryCount(count)} {count === 1 ? 'matches' : 'match'}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="button" variant="destructive" disabled={confirmDisabled} onClick={() => void handlePurge()}>
            {count !== null ? `Delete ${entryCount(count)} permanently?` : 'Delete history entries permanently?'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
