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
import type {
  DefinitionProblem, Recurrence, ScheduleDefinition, ScheduleItemInput, ScheduleWorkflowOption,
} from '../../lib/api/types';
import { ApiError } from '../../lib/api/client';

// The editor works on a tree of EditorItem (a ScheduleItemInput plus a React key and a note) and turns
// it into a ScheduleDefinition on Save. The server's parseScheduleDefinition is the only validator.

export type ValueSource = NonNullable<ScheduleItemInput['params']>[string];
export const ENDINGS = ['completed', 'stopped', 'aborted', 'errored'] as const;
export type Ending = (typeof ENDINGS)[number];
export const ENDING_LABEL: Record<Ending, string> = { completed: 'Completed', stopped: 'Stopped', aborted: 'Aborted', errored: 'Errored' };

/** Server limits (definition.ts); the editor stops offering Add past them. */
export const MAX_ITEMS = 100;
export const MAX_LEVELS = 8;

export type EditorItem = {
  key: string;
  workflowName: string;
  /** null = "Resolve at Enable". */
  version: string | null;
  triggerOn: Ending[];
  params: Record<string, ValueSource>;
  chain: EditorItem[];
  /** What was loaded, so an unchanged Save reproduces the stored body: a stored `params: {}`, and
   *  stored blank fixed values (blanks the user creates are left out; loaded ones are kept). */
  hadParams?: boolean;
  keepBlank?: string[];
  /** A one-line remark shown under the item after its workflow changed; never saved. */
  note?: string;
};
export type EditorState = {
  name: string; description: string; recurrence: Recurrence; items: EditorItem[];
  /** The loaded Master had a description (even blank): it is saved back verbatim. */
  hadDescription?: boolean;
};

let keySeq = 0;
export const newKey = () => `i${++keySeq}`;

export function newItem(over: Partial<EditorItem> = {}): EditorItem {
  return { key: newKey(), workflowName: '', version: null, triggerOn: [], params: {}, chain: [], ...over };
}

const isEmptyFixed = (s: ValueSource) => 'value' in s && s.value === '';

function itemFrom(input: ScheduleItemInput): EditorItem {
  return newItem({
    workflowName: input.workflow.name,
    version: input.workflow.version ?? null,
    triggerOn: (input.triggerOn ?? []).filter((e): e is Ending => (ENDINGS as readonly string[]).includes(e)),
    params: { ...(input.params ?? {}) },
    hadParams: input.params !== undefined,
    keepBlank: Object.entries(input.params ?? {}).filter(([, v]) => isEmptyFixed(v)).map(([k]) => k),
    chain: (input.chain ?? []).map(itemFrom),
  });
}

export function todayDate(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const defaultRecurrence = (): Recurrence =>
  ({ type: 'daily', every: 1, times: ['06:00'], range: { startDate: todayDate(), noEnd: true } });

export function fromDefinition(def: ScheduleDefinition | null): EditorState {
  if (!def) return { name: '', description: '', recurrence: defaultRecurrence(), items: [] };
  return {
    name: def.name, description: def.description ?? '', recurrence: def.recurrence, items: def.items.map(itemFrom),
    hadDescription: def.description !== undefined,
  };
}


function itemTo(it: EditorItem, chained: boolean): ScheduleItemInput {
  const out: ScheduleItemInput = { workflow: it.version === null ? { name: it.workflowName } : { name: it.workflowName, version: it.version } };
  // Loaded order is kept; toggling an ending appends or removes just that one.
  if (chained) out.triggerOn = [...it.triggerOn];
  // A blank fixed value the user made is left out (the parameter then behaves as at a manual Start);
  // one that was loaded blank is kept, so an unchanged Save sends the stored body.
  const params = Object.fromEntries(Object.entries(it.params).filter(([k, s]) => !isEmptyFixed(s) || (it.keepBlank ?? []).includes(k)));
  if (Object.keys(params).length > 0 || it.hadParams) out.params = params;
  if (it.chain.length > 0) out.chain = it.chain.map((c) => itemTo(c, true));
  return out;
}

export function toDefinition(state: EditorState): ScheduleDefinition {
  const def: ScheduleDefinition = { name: state.name, recurrence: state.recurrence, items: state.items.map((i) => itemTo(i, false)) };
  if (state.description !== '' || state.hadDescription) def.description = state.description;
  return def;
}

export function countItems(items: EditorItem[]): number {
  return items.reduce((n, i) => n + 1 + countItems(i.chain), 0);
}

// ------------------------------------------------------------------------ tree edits (by key)

export function mapItem(items: EditorItem[], key: string, fn: (i: EditorItem) => EditorItem): EditorItem[] {
  return items.map((i) => (i.key === key ? fn(i) : { ...i, chain: mapItem(i.chain, key, fn) }));
}
export function removeItem(items: EditorItem[], key: string): EditorItem[] {
  return items.filter((i) => i.key !== key).map((i) => ({ ...i, chain: removeItem(i.chain, key) }));
}
function moveWithin(list: EditorItem[], from: number, to: number): EditorItem[] {
  if (from < 0 || to < 0 || from >= list.length || to >= list.length || from === to) return list;
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}
/** Move an item up (-1) or down (+1) among its siblings. */
export function moveItem(items: EditorItem[], key: string, delta: -1 | 1): EditorItem[] {
  const at = items.findIndex((i) => i.key === key);
  if (at >= 0) return moveWithin(items, at, at + delta);
  return items.map((i) => ({ ...i, chain: moveItem(i.chain, key, delta) }));
}
/** Drop `dragKey` into the slot of `targetKey`, when both are siblings. */
export function dropItem(items: EditorItem[], dragKey: string, targetKey: string): EditorItem[] {
  const from = items.findIndex((i) => i.key === dragKey);
  const to = items.findIndex((i) => i.key === targetKey);
  if (from >= 0 && to >= 0) return moveWithin(items, from, to);
  return items.map((i) => ({ ...i, chain: dropItem(i.chain, dragKey, targetKey) }));
}

// ------------------------------------------------------------------------------ workflows

const STATE_RANK = ['Effective', 'Approved', 'InReview', 'InTest', 'Draft'];

/** The row whose parameters an item shows: its pinned version, else the one Enable would resolve. */
export function representative(options: ScheduleWorkflowOption[], name: string, version: string | null): ScheduleWorkflowOption | null {
  const rows = options.filter((o) => o.name === name);
  if (version !== null) return rows.find((o) => o.version === version) ?? null;
  const rank = (o: ScheduleWorkflowOption) => { const r = STATE_RANK.indexOf(o.state); return r < 0 ? STATE_RANK.length : r; };
  return [...rows].sort((a, b) => rank(a) - rank(b) || (a.version < b.version ? 1 : -1))[0] ?? null;
}

/** Literal defaults, as the Start form prefills them. Empty ones are left out. */
export function literalDefaults(wf: ScheduleWorkflowOption | null): Record<string, ValueSource> {
  const out: Record<string, ValueSource> = {};
  for (const p of wf?.startingParameters ?? []) if (p.valueType === 'literal' && p.defaultValue !== '') out[p.id] = { value: p.defaultValue };
  return out;
}

/** The item with another workflow: values whose parameter id still exists stay; the rest go, with a note. */
export function changeWorkflow(it: EditorItem, name: string, options: ScheduleWorkflowOption[]): EditorItem {
  const wf = representative(options, name, null);
  const ids = new Set((wf?.startingParameters ?? []).map((p) => p.id));
  const kept: Record<string, ValueSource> = {};
  const dropped: string[] = [];
  for (const [id, src] of Object.entries(it.params)) {
    if (ids.has(id)) kept[id] = src;
    else if (!isEmptyFixed(src)) dropped.push(id);
  }
  const params = { ...literalDefaults(wf), ...kept };
  const note = it.workflowName === '' || dropped.length === 0 ? undefined
    : `Kept ${Object.keys(kept).length} value${Object.keys(kept).length === 1 ? '' : 's'} that ${name} also has. Dropped ${dropped.join(', ')}: ${name} has no such parameter.`;
  return { ...it, workflowName: name, version: null, params, note };
}

/** Warnings the server would only raise at Enable; Save never waits on them. */
export function warningsFor(items: EditorItem[], options: ScheduleWorkflowOption[]): { itemKey: string; text: string }[] {
  const out: { itemKey: string; text: string }[] = [];
  const visit = (list: EditorItem[], parent: EditorItem | null) => {
    for (const it of list) {
      if (it.workflowName !== '') {
        const known = options.some((o) => o.name === it.workflowName);
        const wf = representative(options, it.workflowName, it.version);
        if (!known) out.push({ itemKey: it.key, text: `Workflow "${it.workflowName}" was not found in this work center. Enable will refuse it until it is added again.` });
        else if (!wf) out.push({ itemKey: it.key, text: `Version ${it.version} of "${it.workflowName}" was not found in this work center.` });
        else {
          const ids = new Set(wf.startingParameters.map((p) => p.id));
          for (const id of Object.keys(it.params)) {
            if (!ids.has(id)) out.push({ itemKey: it.key, text: `${it.workflowName} has no parameter ${id}.` });
          }
        }
        const parentWf = parent ? representative(options, parent.workflowName, parent.version) : null;
        if (parent && parentWf) {
          for (const [id, src] of Object.entries(it.params)) {
            if (!('from' in src) || (src.from !== 'trigger.input' && src.from !== 'trigger.output') || src.name === '') continue;
            const have = src.from === 'trigger.input' ? parentWf.startingParameters.map((p) => p.id) : parentWf.outputs;
            if (!have.includes(src.name)) {
              out.push({ itemKey: it.key, text: `${id} reads ${src.name} from ${parent.workflowName}, which has no such ${src.from === 'trigger.input' ? 'starting value' : 'output'}.` });
            }
          }
        }
      }
      visit(it.chain, it);
    }
  };
  visit(items, null);
  return out;
}

// ------------------------------------------------------------------------------- problems

/** The `details` of a failed Save or Enable: the server's list of problems, else none. */
export function problemsOf(err: unknown): DefinitionProblem[] {
  if (!(err instanceof ApiError)) return [];
  const details = (err.body as { error?: { details?: unknown } } | undefined)?.error?.details;
  if (!Array.isArray(details)) return [];
  return details.filter((d): d is DefinitionProblem =>
    typeof d === 'object' && d !== null && typeof (d as DefinitionProblem).path === 'string' && typeof (d as DefinitionProblem).message === 'string');
}

/** `items[1].chain[0].params.Lot` as "Start item 2, chained item 1, Lot". */
export function describePath(path: string): string {
  if (path === '') return 'Schedule';
  const parts: string[] = [];
  for (const seg of path.split('.')) {
    const m = /^(\w+)\[(\d+)\]$/.exec(seg);
    if (m) parts.push(m[1] === 'items' ? `Start item ${Number(m[2]) + 1}` : m[1] === 'chain' ? `chained item ${Number(m[2]) + 1}` : seg);
    else if (seg === 'items') parts.push('Start list');
    else if (seg === 'recurrence') parts.push('Recurrence');
    else if (seg === 'name') parts.push('Name');
    else if (seg === 'params' || seg === 'workflow') continue;
    else parts.push(seg);
  }
  return parts.join(', ');
}

/** Path prefix of the item at `indexes` (start index first). */
export const itemPath = (indexes: number[]) =>
  indexes.map((n, d) => (d === 0 ? `items[${n}]` : `chain[${n}]`)).join('.');
