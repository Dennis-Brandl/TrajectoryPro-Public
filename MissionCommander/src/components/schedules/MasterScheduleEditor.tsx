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
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { schedules } from '@/lib/api/schedules';
import type { DefinitionProblem, MasterScheduleView, Recurrence, ScheduleWorkflowOption } from '@/lib/api/types';
import { ChangeReasonDialog } from './ChangeReasonDialog';
import { RecurrenceForm } from './RecurrenceForm';
import { ItemContext, ItemList, ProblemText, problemsAt, type ItemEditorContext } from './ScheduleItemEditor';
import { defaultOnError, type OnError } from './schedule-format';
import {
  MAX_ITEMS, countItems, describePath, dropItem, fromDefinition, mapItem, moveItem, newItem, problemsOf, removeItem,
  toDefinition, warningsFor, type EditorState,
} from './master-schedule-model';

/** The Master Schedule editor (spec 2026-11-08 §10), shown in place of the Schedules tab, as the
 *  Runtime Schedule detail is: a form this large does not fit a dialog. Saving warns about what
 *  Enable would refuse, but does not block; the server's validator decides what is invalid. */
export function MasterScheduleEditor({ workCenterId, master, onClose, onSaved, onError = defaultOnError }: {
  workCenterId: string;
  /** The Master Schedule to edit; null starts a new one. */
  master: MasterScheduleView | null;
  onClose: () => void;
  onSaved: (saved: MasterScheduleView) => void;
  onError?: OnError;
}) {
  const [state, setState] = useState<EditorState>(() => fromDefinition(master));
  const initial = useRef(JSON.stringify(toDefinition(state)));
  const [options, setOptions] = useState<ScheduleWorkflowOption[] | null>(null);
  const [problems, setProblems] = useState<DefinitionProblem[]>([]);
  const [saving, setSaving] = useState(false);
  // Save asks why first; the reason goes to the Master's change history.
  const [askingReason, setAskingReason] = useState(false);

  useEffect(() => {
    let live = true;
    schedules.workflowOptions(workCenterId).then(
      (o) => { if (live) setOptions(o); },
      (err) => { if (live) { setOptions([]); onError(err, 'Loading the work center workflows failed'); } },
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per work center
  }, [workCenterId]);

  const dirty = JSON.stringify(toDefinition(state)) !== initial.current;
  // Until the workflow list is in, nothing can be called "not found".
  const warnings = useMemo(() => (options === null ? [] : warningsFor(state.items, options)), [state.items, options]);
  const edit = (fn: (s: EditorState) => EditorState) => setState((s) => fn(s));
  const setItems = (fn: (items: EditorState['items']) => EditorState['items']) => edit((s) => ({ ...s, items: fn(s.items) }));

  const ctx: ItemEditorContext = {
    options: options ?? [], problems, warnings, totalItems: countItems(state.items),
    update: (key, fn) => setItems((items) => mapItem(items, key, fn)),
    remove: (key) => setItems((items) => removeItem(items, key)),
    move: (key, delta) => setItems((items) => moveItem(items, key, delta)),
    drop: (dragKey, targetKey) => setItems((items) => dropItem(items, dragKey, targetKey)),
    addChild: (parentKey) => setItems((items) => parentKey === null
      ? [...items, newItem()]
      : mapItem(items, parentKey, (p) => ({ ...p, chain: [...p.chain, newItem({ triggerOn: ['completed'] })] }))),
  };

  const close = () => {
    if (dirty && !window.confirm('Discard your changes to this Master Schedule?')) return;
    onClose();
  };

  // Nothing changed on an existing Master: there is nothing to send (a second safeguard behind the
  // disabled Save button), so a stray submit makes no request.
  const nothingToSave = master !== null && !dirty;
  const save = async (reason: string) => {
    if (nothingToSave) return;
    setSaving(true);
    setProblems([]);
    try {
      const def = toDefinition(state);
      const saved = master
        ? await schedules.replaceMaster(master.id, def, reason)
        : await schedules.createMaster(workCenterId, def, reason);
      setAskingReason(false);
      if (warnings.length > 0) {
        toast.warning(`Saved with ${warnings.length} warning${warnings.length === 1 ? '' : 's'}. Enable will refuse what they describe.`);
      }
      onSaved(saved);
    } catch (err) {
      setAskingReason(false);
      const found = problemsOf(err);
      if (found.length > 0) setProblems(found);
      else onError(err, 'Saving the Master Schedule failed');
    } finally { setSaving(false); }
  };

  return (
    <ItemContext.Provider value={ctx}>
      <form className="mx-auto max-w-4xl space-y-6" onSubmit={(e) => { e.preventDefault(); if (!nothingToSave) setAskingReason(true); }}>
        <h3 className="text-lg font-semibold">{master ? `Edit Master Schedule: ${master.name}` : 'New Master Schedule'}</h3>
        {master && <p className="text-sm text-muted-foreground">Version {master.revision}. Saving a change makes version {master.revision + 1}.</p>}

        {master?.source === 'api' && (
          <p role="note" className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
            Managed by {master.managedBy ?? 'an outside system'}. Your edits will be replaced the next time it sends this schedule.
          </p>
        )}

        {problems.length > 0 && (
          <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
            <p className="font-medium">This Master Schedule was not saved:</p>
            <ul className="list-disc pl-5">
              {problems.map((p, i) => <li key={i}>{describePath(p.path)}: {p.message}</li>)}
            </ul>
          </div>
        )}
        {warnings.length > 0 && (
          <div role="status" className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
            <p className="font-medium">Warnings. You can still save; Enable will refuse these until they are fixed:</p>
            <ul className="list-disc pl-5">{warnings.map((w, i) => <li key={i}>{w.text}</li>)}</ul>
          </div>
        )}

        <section className="space-y-3">
          <div className="space-y-1">
            <label htmlFor="ms-name" className="text-sm font-medium">Name</label>
            <Input id="ms-name" value={state.name} onChange={(e) => edit((s) => ({ ...s, name: e.target.value }))} />
            <ProblemText problems={problemsAt(problems, 'name')} />
          </div>
          <div className="space-y-1">
            <label htmlFor="ms-description" className="text-sm font-medium">Description</label>
            <Input id="ms-description" value={state.description} onChange={(e) => edit((s) => ({ ...s, description: e.target.value }))} />
            <ProblemText problems={problemsAt(problems, 'description')} />
          </div>
        </section>

        <section className="space-y-2">
          <h4 className="text-sm font-medium">Recurrence</h4>
          <RecurrenceForm workCenterId={workCenterId} value={state.recurrence}
            onChange={(r: Recurrence) => edit((s) => ({ ...s, recurrence: r }))} />
          <ProblemText problems={problemsAt(problems, 'recurrence')} />
        </section>

        <section className="space-y-2">
          <h4 className="text-sm font-medium">Workflows to start</h4>
          <ProblemText problems={problemsAt(problems, 'items')} />
          <ItemList items={state.items} parent={null} path="" level={1} />
          <Button type="button" variant="outline" size="sm" disabled={ctx.totalItems >= MAX_ITEMS} onClick={() => ctx.addChild(null)}>Add workflow</Button>
        </section>

        <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
          <Button type="button" variant="outline" onClick={close}>Cancel</Button>
          <Button type="submit" disabled={saving || nothingToSave}>Save</Button>
        </div>
      </form>
      {askingReason && (
        <ChangeReasonDialog version={master ? master.revision + 1 : 1} initial={master ? '' : 'Initial version'} busy={saving}
          onConfirm={(reason) => { void save(reason); }} onClose={() => setAskingReason(false)} />
      )}
    </ItemContext.Provider>
  );
}
