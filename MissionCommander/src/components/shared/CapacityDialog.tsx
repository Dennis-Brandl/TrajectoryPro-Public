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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ResourceTableRow } from './ResourceTable';

// Spec 2026-11-26: a resource's shares, count or names are the work center's own. Designer's
// value is shown for reference only; a load never changes what is saved here.

export type CapacityBody = { name: string; useLimit: number } | { name: string; names: string[] };

const MAX_NAMES = 500;
const MAX_NAME = 200;
const MAX_INT = 2147483647;

/** The row's button text, or null when the type has no count or names to change. */
export function capacityLabel(resourceType: string): string | null {
  switch (resourceType) {
    case 'binary shared use with pool limits': return 'Change shares…';
    case 'countable use with pool limits': return 'Change count…';
    case 'named pool': return 'Change names…';
    default: return null;
  }
}

/** The trimmed list, or the reason it cannot be saved. Mirrors the engine's own check. */
function checkNames(text: string): string[] | string {
  const list = text.split('\n').map((n) => n.trim()).filter((n) => n !== '');
  if (list.length === 0) return 'Enter at least one name.';
  if (list.length > MAX_NAMES) return `At most ${MAX_NAMES} names.`;
  const long = list.find((n) => n.length > MAX_NAME);
  if (long) return `"${long.slice(0, 20)}…" is longer than ${MAX_NAME} characters.`;
  const seen = new Set<string>();
  for (const n of list) {
    if (seen.has(n)) return `"${n}" is listed twice.`;
    seen.add(n);
  }
  return list;
}

export function CapacityDialog({ row, busy, onSave, onClose }: {
  row: ResourceTableRow; busy: boolean; onSave: (body: CapacityBody) => void; onClose: () => void;
}) {
  const cap = row.capacity!;
  const named = row.resourceType === 'named pool';
  const word = row.resourceType === 'binary shared use with pool limits' ? 'Shares' : 'Count';
  const [count, setCount] = useState(String(cap.useLimit ?? 1));
  const [text, setText] = useState(cap.poolNames.join('\n'));

  let problem: string | null = null;
  let note: string | null = null;
  let body: CapacityBody | null = null;
  if (named) {
    const list = checkNames(text);
    if (typeof list === 'string') problem = list;
    else {
      body = { name: row.name, names: list };
      const dropped = cap.heldNames.filter((n) => !list.includes(n));
      if (dropped.length > 0) {
        note = `${dropped.join(', ')} ${dropped.length === 1 ? 'is' : 'are'} in use; ${dropped.length === 1 ? 'it finishes' : 'they finish'}, then ${dropped.length === 1 ? 'is' : 'are'} not handed out again.`;
      }
    }
  } else {
    const n = Number(count);
    if (count.trim() === '' || !Number.isInteger(n) || n < 1 || n > MAX_INT) problem = 'Enter a whole number of at least 1.';
    else {
      body = { name: row.name, useLimit: n };
      if (n < row.inUse) note = `${row.inUse} are in use; they finish, and nothing new starts until there is room.`;
    }
  }

  const designer = cap.designerDefault;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{named ? 'Change names' : `Change ${word.toLowerCase()}`} for “{row.name}”</DialogTitle>
          <DialogDescription>
            This work center’s own setting. Loading the environment again does not change it.
          </DialogDescription>
        </DialogHeader>
        {named ? (
          <div className="space-y-1">
            <Label htmlFor="capacity-names">Names, one per line</Label>
            <textarea id="capacity-names" rows={8} value={text} onChange={(e) => setText(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
            {designer && <p className="text-xs text-muted-foreground">Designer’s names: {designer.names.join(', ') || '(none)'}</p>}
          </div>
        ) : (
          <div className="space-y-1">
            <Label htmlFor="capacity-count">{word}</Label>
            <Input id="capacity-count" type="number" min={1} step={1} value={count} onChange={(e) => setCount(e.target.value)} />
            <p className="text-xs text-muted-foreground">In use now: {row.inUse}</p>
            {designer && <p className="text-xs text-muted-foreground">Designer’s value: {designer.useLimit ?? 1}</p>}
          </div>
        )}
        {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
        {note && <p className="text-sm text-amber-700 dark:text-amber-400">{note}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={busy || body === null} onClick={() => { if (body) onSave(body); }}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
