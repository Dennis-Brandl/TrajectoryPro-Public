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
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type LinkPickerModalProps<T extends { id: string; name: string }> = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  fetchItems: () => Promise<T[]>;
  linkedIds: Set<string>;
  /** Single-select mode: one action button per row, invoked immediately. Ignored when
   *  onLinkMany is present. */
  onLink?: (id: string) => Promise<void>;
  /** Multi-select mode (2026-08-10 user-testing ticket: assigning roles one at a time was
   *  too much work): rows become checkboxes and a single footer action submits the whole
   *  selection. Providing this switches the mode. */
  onLinkMany?: (ids: string[]) => Promise<void>;
  // Defaults to 'Link' so the three WorkCenterDetail mounts are unchanged. LibraryDetail
  // passes 'Add', because filing a spec into a library is a MOVE, not a link.
  actionLabel?: string;
};

// Generic "search the picker, pick not-yet-linked items, link them" dialog shared by the
// workflow/user/environment tabs on WorkCenterDetail (single mode) and UserDetail's role
// picker (multi mode). It only lists, filters, and invokes onLink/onLinkMany — the caller
// owns toasting, applying the refreshed view, and closing the dialog on success (only the
// caller knows whether the link succeeded).
export function LinkPickerModal<T extends { id: string; name: string }>({
  open, onOpenChange, title, fetchItems, linkedIds, onLink, onLinkMany, actionLabel = 'Link',
}: LinkPickerModalProps<T>) {
  const [items, setItems] = useState<T[]>([]);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const reqId = useRef(0);
  const multi = onLinkMany !== undefined;

  useEffect(() => {
    const my = ++reqId.current; // invalidate any prior in-flight fetch (this fires on close and reopen)
    if (open) {
      setSearch(''); // never show a stale filter from a previous open
      setFailed(false); // reset on every open — a prior failure must not latch
      setChecked(new Set()); // a fresh open never inherits a previous selection
      fetchItems()
        .then((data) => { if (my === reqId.current) setItems(data); })
        .catch(() => { if (my === reqId.current) { setItems([]); setFailed(true); } }); // distinct from a genuinely empty picker
    }
  }, [open, fetchItems]);

  const visible = items.filter(
    (item) => !linkedIds.has(item.id) && item.name.toLowerCase().includes(search.toLowerCase()),
  );
  // A checked item can leave the pickable set mid-open (a partial multi-submit grows
  // linkedIds), so the submitted/counted selection is always re-derived, never trusted.
  const selected = [...checked].filter((id) => !linkedIds.has(id) && items.some((i) => i.id === id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {multi
              ? `Search and check items, then click ${actionLabel} to add them.`
              : `Search for an item and click ${actionLabel} to add it.`}
          </DialogDescription>
        </DialogHeader>
        <Input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="max-h-72 space-y-1 overflow-auto">
          {visible.length === 0 ? (
            <p className="text-sm text-muted-foreground">{failed ? 'Failed to load items' : 'No items found'}</p>
          ) : multi ? (
            visible.map((item) => (
              <label key={item.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-accent">
                <input type="checkbox" className="size-4" checked={checked.has(item.id)} disabled={busyId !== null}
                  onChange={(e) => setChecked((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(item.id); else next.delete(item.id);
                    return next;
                  })} />
                <span className="truncate text-sm">{item.name}</span>
              </label>
            ))
          ) : (
            visible.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-2 rounded px-2 py-1 hover:bg-accent">
                <span className="truncate text-sm">{item.name}</span>
                <Button type="button" size="sm" disabled={busyId !== null}
                  onClick={async () => { setBusyId(item.id); try { await onLink!(item.id); } finally { setBusyId(null); } }}>
                  {actionLabel}
                </Button>
              </div>
            ))
          )}
        </div>
        {multi && (
          <div className="flex justify-end">
            <Button type="button" size="sm" disabled={selected.length === 0 || busyId !== null}
              onClick={async () => { setBusyId('*'); try { await onLinkMany!(selected); } finally { setBusyId(null); } }}>
              {selected.length > 0 ? `${actionLabel} (${selected.length})` : actionLabel}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
