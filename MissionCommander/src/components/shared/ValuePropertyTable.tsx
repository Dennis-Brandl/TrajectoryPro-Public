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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RequiresTooltip } from '@/components/shared/RequiresTooltip';
import type { SharedValuePropertyView } from '@/lib/api/types';

// Value properties grouped by property name (spec §6.3): one group-header row per property,
// then Entry · Value · Updated (· Actions, Phase 4b). The `Description` entry is SHOWN but
// labelled as annotation — the engine excludes it from group reads (spec §5.6) and the pane
// must not imply otherwise. Editing (spec §7.3) is inline: Edit swaps the value cell for an
// input; Save hands the row + new value to the caller, which posts through useActionRunner and
// refreshes — the cell keeps the last-known value until then (no optimistic write).

const BADGE = 'ml-2 shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground';
const SYSTEM_COMMANDER_REASON = 'Requires Mission System Commander';

export type ValueEditHandlers = {
  canCommand: boolean; busy: boolean;
  /** Rendered above the table — the Runtime pane's shared group says the edit is work-center-wide (spec §7.3). */
  note?: string;
  onSave: (row: SharedValuePropertyView, value: string) => void;
};
export type FlatValueEditHandlers = { canCommand: boolean; busy: boolean; onSave: (key: string, value: string) => void };

// Groups by FIRST-APPEARANCE order of the property, entries in input order within a group.
// Postgres does not preserve jsonb key order (keys come back sorted by length, then bytes), so
// a jsonb-fed flat store (property_store, engine_state.childProperties) can interleave two
// properties' entries — grouping by adjacency alone would split one property into repeated
// groups with duplicate React keys. Map-based grouping is immune to that interleaving.
export function groupByProperty<T extends { propertyName: string }>(values: T[]): { propertyName: string; entries: T[] }[] {
  const order: string[] = [];
  const byName = new Map<string, T[]>();
  for (const v of values) {
    let entries = byName.get(v.propertyName);
    if (!entries) { entries = []; byName.set(v.propertyName, entries); order.push(v.propertyName); }
    entries.push(v);
  }
  return order.map((propertyName) => ({ propertyName, entries: byName.get(propertyName)! }));
}

/** The engine stores a flat map keyed `${property}.${entry}` (properties.ts
 *  initializeFromWorkflow) and resolves a group by `key + '.'` prefix — so the FIRST dot is the
 *  boundary. A key with no dot is its own group with an empty entry name. */
export function splitPropertyKey(key: string): { propertyName: string; entryName: string } {
  const dot = key.indexOf('.');
  return dot < 0 ? { propertyName: key, entryName: '' } : { propertyName: key.slice(0, dot), entryName: key.slice(dot + 1) };
}

function GroupRow({ name, colSpan }: { name: string; colSpan: number }) {
  return <TableRow className="bg-muted/40"><TableCell colSpan={colSpan} className="font-medium">{name}</TableCell></TableRow>;
}

function ValueCell({ value }: { value: string }) {
  return (
    <TableCell className="whitespace-pre-wrap break-all font-mono text-xs">
      {value === '' ? <span className="font-sans text-muted-foreground">(empty)</span> : value}
    </TableCell>
  );
}

function EditCell({ keyLabel, draft, busy, onDraft, onSave, onCancel }: {
  keyLabel: string; draft: string; busy: boolean; onDraft: (v: string) => void; onSave: () => void; onCancel: () => void;
}) {
  return (
    <TableCell>
      <Input aria-label={`New value for ${keyLabel}`} value={draft} disabled={busy} className="font-mono text-xs"
        onChange={(e) => onDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onSave(); if (e.key === 'Escape') onCancel(); }} />
    </TableCell>
  );
}

function ActionsCell({ editing, keyLabel, canCommand, busy, onEdit, onSave, onCancel }: {
  editing: boolean; keyLabel: string; canCommand: boolean; busy: boolean; onEdit: () => void; onSave: () => void; onCancel: () => void;
}) {
  const reason = canCommand ? undefined : SYSTEM_COMMANDER_REASON;
  return (
    <TableCell>
      {editing ? (
        <div className="flex gap-1">
          <Button type="button" size="sm" disabled={busy} onClick={onSave}>Save</Button>
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        </div>
      ) : (
        <RequiresTooltip reason={reason}>
          <Button type="button" variant="ghost" size="sm" aria-label={`Edit ${keyLabel}`} disabled={!canCommand || busy} title={reason} onClick={onEdit}>Edit</Button>
        </RequiresTooltip>
      )}
    </TableCell>
  );
}

export function ValuePropertyTable({ values, emptyText, edit }: { values: SharedValuePropertyView[]; emptyText: string; edit?: ValueEditHandlers }) {
  const [editing, setEditing] = useState<{ key: string; draft: string } | null>(null);
  if (values.length === 0) return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  const colSpan = edit ? 4 : 3;
  return (
    <div className="space-y-1">
      {edit?.note && <p className="text-xs text-muted-foreground">{edit.note}</p>}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Entry</TableHead><TableHead>Value</TableHead><TableHead>Updated</TableHead>
            {edit && <TableHead>Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {groupByProperty(values).map((g) => (
            <Fragment key={g.propertyName}>
              <GroupRow name={g.propertyName} colSpan={colSpan} />
              {g.entries.map((v) => {
                const key = `${v.propertyName}.${v.entryName}`;
                const isEditing = editing?.key === key;
                return (
                  <TableRow key={key}>
                    <TableCell>
                      {v.entryName}
                      {v.annotation && <span className={BADGE} title="Human annotation — excluded from group reads at runtime">annotation</span>}
                      {v.orphaned && <span className={BADGE} title="The declaring environment spec was deleted; the value outlived it">orphaned</span>}
                    </TableCell>
                    {isEditing && edit
                      ? <EditCell keyLabel={key} draft={editing.draft} busy={edit.busy} onDraft={(d) => setEditing({ key, draft: d })}
                          onSave={() => { edit.onSave(v, editing.draft); setEditing(null); }} onCancel={() => setEditing(null)} />
                      : <ValueCell value={v.value} />}
                    <TableCell className="text-muted-foreground">
                      {new Date(v.updatedAt).toLocaleString()}{v.updatedByName ? ` · ${v.updatedByName}` : ''}
                    </TableCell>
                    {edit && (
                      <ActionsCell editing={isEditing} keyLabel={key} canCommand={edit.canCommand} busy={edit.busy}
                        onEdit={() => setEditing({ key, draft: v.value })}
                        onSave={() => { if (editing) { edit.onSave(v, editing.draft); setEditing(null); } }}
                        onCancel={() => setEditing(null)} />
                    )}
                  </TableRow>
                );
              })}
            </Fragment>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** An instance's own store (root or child) is a flat map with no timestamps: Entry · Value only
 *  (· Actions when editable). */
export function FlatPropertyTable({ values, emptyText, edit }: { values: Record<string, string>; emptyText: string; edit?: FlatValueEditHandlers }) {
  const [editing, setEditing] = useState<{ key: string; draft: string } | null>(null);
  const keys = Object.keys(values);
  if (keys.length === 0) return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  const rows: { key: string; propertyName: string; entryName: string; value: string }[] = keys.map((key) => {
    const { propertyName, entryName } = splitPropertyKey(key);
    return { key, propertyName, entryName, value: values[key] };
  });
  const groups = groupByProperty(rows);
  const colSpan = edit ? 3 : 2;
  return (
    <Table>
      <TableHeader>
        <TableRow><TableHead>Entry</TableHead><TableHead>Value</TableHead>{edit && <TableHead>Actions</TableHead>}</TableRow>
      </TableHeader>
      <TableBody>
        {groups.map((g) => (
          <Fragment key={g.propertyName}>
            <GroupRow name={g.propertyName} colSpan={colSpan} />
            {g.entries.map((v) => {
              const isEditing = editing?.key === v.key;
              return (
                <TableRow key={v.key}>
                  <TableCell>{v.entryName === '' ? <span className="text-muted-foreground">—</span> : v.entryName}</TableCell>
                  {isEditing && edit
                    ? <EditCell keyLabel={v.key} draft={editing.draft} busy={edit.busy} onDraft={(d) => setEditing({ key: v.key, draft: d })}
                        onSave={() => { edit.onSave(v.key, editing.draft); setEditing(null); }} onCancel={() => setEditing(null)} />
                    : <ValueCell value={v.value} />}
                  {edit && (
                    <ActionsCell editing={isEditing} keyLabel={v.key} canCommand={edit.canCommand} busy={edit.busy}
                      onEdit={() => setEditing({ key: v.key, draft: v.value })}
                      onSave={() => { if (editing) { edit.onSave(v.key, editing.draft); setEditing(null); } }}
                      onCancel={() => setEditing(null)} />
                  )}
                </TableRow>
              );
            })}
          </Fragment>
        ))}
      </TableBody>
    </Table>
  );
}
