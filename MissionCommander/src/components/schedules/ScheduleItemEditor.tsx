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
import { createContext, useContext, useRef, useState, type MutableRefObject } from 'react';
import { SearchableSelect, type ComboboxGroup } from '@mission/ui/combobox';
import { Button } from '@/components/ui/button';
import type { DefinitionProblem, ScheduleWorkflowOption } from '@/lib/api/types';
import { NativeSelect } from './form-controls';
import {
  ENDINGS, ENDING_LABEL, MAX_ITEMS, MAX_LEVELS, changeWorkflow, representative, type EditorItem, type Ending, type ValueSource,
} from './master-schedule-model';
import { ValueSourceField } from './ValueSourceField';

// One workflow of a Master Schedule: its picker, version, starting values, endings and chain.

export type ItemEditorContext = {
  options: ScheduleWorkflowOption[];
  problems: DefinitionProblem[];
  warnings: { itemKey: string; text: string }[];
  totalItems: number;
  update: (key: string, fn: (i: EditorItem) => EditorItem) => void;
  remove: (key: string) => void;
  move: (key: string, delta: -1 | 1) => void;
  drop: (dragKey: string, targetKey: string) => void;
  addChild: (parentKey: string | null) => void;
};
export const ItemContext = createContext<ItemEditorContext | null>(null);
const useCtx = () => {
  const c = useContext(ItemContext);
  if (!c) throw new Error('ScheduleItemEditor needs an ItemContext');
  return c;
};

/** The problems the server named at exactly this path. */
export const problemsAt = (problems: DefinitionProblem[], ...paths: string[]) => problems.filter((p) => paths.includes(p.path));

export function ProblemText({ problems }: { problems: DefinitionProblem[] }) {
  return <>{problems.map((p, i) => <p key={i} className="text-xs text-destructive">{p.message}</p>)}</>;
}

/** A sibling list. Its drag state is its own, so an item can only be dropped among its siblings. */
export function ItemList({ items, parent, path, level }: { items: EditorItem[]; parent: EditorItem | null; path: string; level: number }) {
  const drag = useRef<string | null>(null);
  if (items.length === 0) return null;
  return (
    <ul className="space-y-3">
      {items.map((it, n) => (
        <ScheduleItemEditor key={it.key} item={it} index={n} count={items.length}
          path={path === '' ? `items[${n}]` : `${path}.chain[${n}]`} level={level} parent={parent} drag={drag} />
      ))}
    </ul>
  );
}

function ScheduleItemEditor({ item, index, count, path, level, parent, drag }: {
  item: EditorItem; index: number; count: number; path: string; level: number; parent: EditorItem | null;
  drag: MutableRefObject<string | null>;
}) {
  const ctx = useCtx();
  const [open, setOpen] = useState(true);
  const name = item.workflowName || '(not chosen)';
  const chained = level > 1;

  const wf = item.workflowName === '' ? null : representative(ctx.options, item.workflowName, item.version);
  const versions = ctx.options.filter((o) => o.name === item.workflowName);
  const parentWf = parent ? representative(ctx.options, parent.workflowName, parent.version) : null;
  const trigger = parent ? { inputs: (parentWf?.startingParameters ?? []).map((p) => p.id), outputs: parentWf?.outputs ?? [] } : null;
  const specIds = new Set((wf?.startingParameters ?? []).map((p) => p.id));
  const extras = Object.keys(item.params).filter((id) => !specIds.has(id));

  const names = [...new Set(ctx.options.map((o) => o.name))];
  const groups: ComboboxGroup[] = [{ items: names.map((n) => ({ value: n })) }];

  const setParam = (id: string, src: ValueSource) => ctx.update(item.key, (i) => ({ ...i, params: { ...i.params, [id]: src } }));
  const dropParam = (id: string) => ctx.update(item.key, (i) => {
    const { [id]: _gone, ...rest } = i.params;
    return { ...i, params: rest };
  });
  const toggleEnding = (e: Ending, on: boolean) => ctx.update(item.key, (i) => ({
    ...i, triggerOn: on ? (i.triggerOn.includes(e) ? i.triggerOn : [...i.triggerOn, e]) : i.triggerOn.filter((x) => x !== e),
  }));

  const own = ctx.warnings.filter((w) => w.itemKey === item.key);
  const canAddChild = level < MAX_LEVELS && ctx.totalItems < MAX_ITEMS;

  return (
    <li aria-label={`Workflow ${name}`} className="rounded-lg border bg-card p-3"
      onDragOver={(e) => { if (drag.current !== null) { e.preventDefault(); e.stopPropagation(); } }}
      onDrop={(e) => {
        if (drag.current === null) return;
        e.preventDefault(); e.stopPropagation();
        const from = drag.current;
        drag.current = null;
        if (from !== item.key) ctx.drop(from, item.key);
      }}>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" draggable aria-label={`Drag ${name} to reorder`} title="Drag, or press the up and down arrow keys"
          className="cursor-grab rounded px-1 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          onDragStart={(e) => { drag.current = item.key; e.dataTransfer?.setData('text/plain', item.key); }}
          onDragEnd={() => { drag.current = null; }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); ctx.move(item.key, e.key === 'ArrowUp' ? -1 : 1); }
          }}>⠿</button>
        <Button type="button" variant="ghost" size="sm" aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${name}`}
          onClick={() => setOpen(!open)}>{open ? '▾' : '▸'}</Button>
        <span className="min-w-24 text-sm font-medium">{item.workflowName || 'New workflow'}</span>
        <div className="ml-auto flex gap-1">
          <Button type="button" variant="outline" size="sm" aria-label={`Move ${name} up`} disabled={index === 0}
            onClick={() => ctx.move(item.key, -1)}>Up</Button>
          <Button type="button" variant="outline" size="sm" aria-label={`Move ${name} down`} disabled={index === count - 1}
            onClick={() => ctx.move(item.key, 1)}>Down</Button>
          <Button type="button" variant="destructiveOutline" size="sm" aria-label={`Remove ${name}`}
            onClick={() => ctx.remove(item.key)}>Remove</Button>
        </div>
      </div>
      <ProblemText problems={problemsAt(ctx.problems, path)} />

      {open && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div role="group" aria-label="Workflow" className="w-64 space-y-1">
              <div className="text-xs text-muted-foreground">Workflow</div>
              <SearchableSelect groups={groups} value={item.workflowName} triggerText={item.workflowName || undefined}
                placeholder="Choose a workflow" searchPlaceholder="Type to filter…" emptyText="No workflows in this work center"
                onSelect={(n) => { if (n !== item.workflowName) ctx.update(item.key, (i) => changeWorkflow(i, n, ctx.options)); }} />
            </div>
            <label className="space-y-1">
              <div className="text-xs text-muted-foreground">Version</div>
              <NativeSelect aria-label="Version" disabled={item.workflowName === ''} value={item.version ?? ''}
                onChange={(e) => ctx.update(item.key, (i) => ({ ...i, version: e.target.value === '' ? null : e.target.value }))}>
                <option value="">Resolve at Enable (recommended)</option>
                {versions.map((v) => <option key={v.version} value={v.version}>{v.version} ({v.state})</option>)}
                {item.version !== null && !versions.some((v) => v.version === item.version) && <option value={item.version}>{item.version} (not found)</option>}
              </NativeSelect>
            </label>
          </div>
          <ProblemText problems={problemsAt(ctx.problems, `${path}.workflow`, `${path}.workflow.version`)} />
          {own.map((w, i) => <p key={i} className="text-xs text-amber-600 dark:text-amber-400">{w.text}</p>)}
          {item.note && <p data-testid="change-note" className="text-xs text-muted-foreground">{item.note}</p>}

          {chained && (
            <fieldset className="space-y-1">
              <legend className="text-xs text-muted-foreground">Start this when the earlier workflow ends as</legend>
              <div className="flex flex-wrap gap-4">
                {ENDINGS.map((e) => {
                  const on = item.triggerOn.includes(e);
                  return (
                    <label key={e} className="flex items-center gap-1 text-sm">
                      <input type="checkbox" checked={on} disabled={on && item.triggerOn.length === 1}
                        onChange={(ev) => toggleEnding(e, ev.target.checked)} />
                      {ENDING_LABEL[e]}
                    </label>
                  );
                })}
              </div>
              <ProblemText problems={ctx.problems.filter((p) => p.path === `${path}.triggerOn` || p.path.startsWith(`${path}.triggerOn[`))} />
            </fieldset>
          )}

          {item.workflowName !== '' && (wf !== null || extras.length > 0) && (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">Starting values</div>
              {(wf?.startingParameters ?? []).map((p) => (
                <ValueSourceField key={p.id} id={p.id} description={p.description} source={item.params[p.id]} defaultValue={p.defaultValue}
                  placeholder={p.valueType === 'property' ? 'Resolved when the run starts' : undefined} parent={trigger}
                  problem={problemsAt(ctx.problems, `${path}.params.${p.id}`)[0]?.message} onChange={(s) => setParam(p.id, s)} />
              ))}
              {extras.map((id) => (
                <ValueSourceField key={id} id={id} source={item.params[id]} parent={trigger} notAParameter
                  problem={problemsAt(ctx.problems, `${path}.params.${id}`)[0]?.message}
                  onChange={(s) => setParam(id, s)} onRemove={() => dropParam(id)} />
              ))}
            </div>
          )}

          <div className="space-y-2 border-l-2 pl-3">
            <ItemList items={item.chain} parent={item} path={path} level={level + 1} />
            <Button type="button" variant="outline" size="sm" disabled={!canAddChild} aria-label={`Add chained workflow to ${name}`}
              onClick={() => ctx.addChild(item.key)}>Add chained workflow</Button>
          </div>
        </div>
      )}
    </li>
  );
}
