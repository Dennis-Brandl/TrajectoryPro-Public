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

// The shape of a Master Schedule as the editor and the REST API send it (spec
// sections 5.3 and 8.4), validated by hand. Whether workflows and parameters exist
// is checked elsewhere (a warning on save, enforced at Enable).

import { SCHEDULE_ENDINGS } from '../db/schema/index.js';
import { parseRecurrence, type Recurrence } from './recurrence.js';
import { parseValueSource, type ValueSource } from './values.js';

export type ScheduleItemInput = {
  workflow: { name: string; version?: string };
  triggerOn?: string[];
  params?: Record<string, ValueSource>;
  chain?: ScheduleItemInput[];
};
export type ScheduleDefinition = {
  name: string;
  description?: string;
  recurrence: Recurrence;
  items: ScheduleItemInput[];
};
export type DefinitionProblem = { path: string; code: string; message: string };

/** Items in one schedule, counting chained ones. */
export const MAX_SCHEDULE_ITEMS = 100;
/** Nesting depth with the start list as level 1. */
export const MAX_CHAIN_LEVELS = 8;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** How deep the raw body may nest, with the body as level 1. Far past anything a valid schedule needs. */
const MAX_NESTING = 64;
/** A body with more problems than this is answered with the first ones only. */
const MAX_PROBLEMS = 20;

type Ctx = { problems: DefinitionProblem[]; count: number; tooDeep: boolean; walkStopped: boolean };

const TOP_KEYS = ['name', 'description', 'recurrence', 'items'];
const ITEM_KEYS = ['workflow', 'triggerOn', 'params', 'chain'];
const WORKFLOW_KEYS = ['name', 'version'];

/** A misspelled field must be refused: dropping it would make a correction look like a no-op. */
function refuseUnknown(input: Record<string, unknown>, allowed: string[], at: (key: string) => string, ctx: Ctx): void {
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) ctx.problems.push({ path: at(key), code: 'UNKNOWN_FIELD', message: `unknown field: ${key}` });
  }
}

export const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

/** Postgres stores neither of these in jsonb, so one here could only end as a server error. */
function textProblem(text: string): string | null {
  if (text.includes('\0')) return 'text cannot contain the NUL character (\\u0000)';
  if (LONE_SURROGATE.test(text)) return 'text cannot contain half of a Unicode character (a lone surrogate, such as \\ud800)';
  return null;
}

/**
 * Walks the raw body before anything else reads it. It stops at MAX_NESTING and MAX_PROBLEMS, so a
 * hostile body cannot overflow the stack here. A stopped walk has left part of the body unchecked:
 * the caller must not go on, because later checks also recurse, as String() does on nested arrays.
 */
function refuseBadText(value: unknown, path: string, depth: number, ctx: Ctx): void {
  const add = (at: string, message: string) => ctx.problems.push({ path: at, code: 'TEXT_INVALID', message });
  const stopped = () => ctx.walkStopped || ctx.problems.length >= MAX_PROBLEMS;
  if (typeof value === 'string') {
    const problem = textProblem(value);
    if (problem) add(path, problem);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  if (depth > MAX_NESTING) {
    ctx.problems.push({ path, code: 'NESTED_TOO_DEEP', message: `a schedule can be nested at most ${MAX_NESTING} levels deep` });
    ctx.walkStopped = true;
    return;
  }
  if (Array.isArray(value)) {
    for (const [i, v] of value.entries()) {
      if (stopped()) return;
      refuseBadText(v, `${path}[${i}]`, depth + 1, ctx);
    }
    return;
  }
  for (const [k, v] of Object.entries(value)) {
    if (stopped()) return;
    const at = path ? `${path}.${k}` : k;
    const problem = textProblem(k);
    if (problem) add(at, problem);
    refuseBadText(v, at, depth + 1, ctx);
  }
}

function parseItem(input: unknown, path: string, level: number, ctx: Ctx): ScheduleItemInput | null {
  const add = (p: string, code: string, message: string) => ctx.problems.push({ path: p, code, message });
  ctx.count++;
  if (!isRecord(input)) {
    add(path, 'ITEM_INVALID', 'an item must be an object');
    return null;
  }
  refuseUnknown(input, ITEM_KEYS, (k) => `${path}.${k}`, ctx);
  const chained = level > 1;
  const item: ScheduleItemInput = { workflow: { name: '' } };

  const wf = input.workflow;
  if (isRecord(wf)) refuseUnknown(wf, WORKFLOW_KEYS, (k) => `${path}.workflow.${k}`, ctx);
  if (!isRecord(wf) || typeof wf.name !== 'string' || wf.name.trim() === '') {
    add(`${path}.workflow`, 'WORKFLOW_INVALID', 'workflow needs a name');
  } else if (wf.version !== undefined && (typeof wf.version !== 'string' || wf.version.trim() === '')) {
    add(`${path}.workflow.version`, 'WORKFLOW_INVALID', 'workflow version must be text');
  } else {
    item.workflow = wf.version === undefined ? { name: wf.name } : { name: wf.name, version: wf.version as string };
  }

  const on = input.triggerOn;
  if (!chained) {
    if (on !== undefined && on !== null) {
      add(`${path}.triggerOn`, 'TRIGGER_ON_NOT_ALLOWED', 'a start-list item has nothing to react to, so it has no triggerOn');
    }
  } else if (!Array.isArray(on) || on.length === 0) {
    add(`${path}.triggerOn`, 'TRIGGER_ON_REQUIRED', `a chained item needs at least one ending: ${SCHEDULE_ENDINGS.join(', ')}`);
  } else {
    const ok: string[] = [];
    on.forEach((e, i) => {
      if (!(SCHEDULE_ENDINGS as readonly unknown[]).includes(e)) {
        add(`${path}.triggerOn[${i}]`, 'TRIGGER_ON_INVALID', `unknown ending: ${String(e)}`);
      } else if (!ok.includes(e as string)) ok.push(e as string);
    });
    item.triggerOn = ok;
  }

  if (input.params !== undefined) {
    if (!isRecord(input.params)) add(`${path}.params`, 'PARAMS_INVALID', 'params must be an object');
    else {
      const params: Record<string, ValueSource> = {};
      for (const [id, src] of Object.entries(input.params)) {
        const r = parseValueSource(src, chained);
        if (r.ok) params[id] = r.value;
        else add(`${path}.params.${id}`, 'VALUE_SOURCE_INVALID', r.message);
      }
      item.params = params;
    }
  }

  if (input.chain !== undefined) {
    if (!Array.isArray(input.chain)) add(`${path}.chain`, 'CHAIN_INVALID', 'chain must be a list');
    else if (input.chain.length > 0) {
      if (level >= MAX_CHAIN_LEVELS) {
        ctx.tooDeep = true;
      } else {
        const chain: ScheduleItemInput[] = [];
        input.chain.forEach((c, i) => {
          const parsed = parseItem(c, `${path}.chain[${i}]`, level + 1, ctx);
          if (parsed) chain.push(parsed);
        });
        item.chain = chain;
      }
    }
  }
  return item;
}

export function parseScheduleDefinition(
  input: unknown,
): { ok: true; value: ScheduleDefinition } | { ok: false; problems: DefinitionProblem[] } {
  if (!isRecord(input)) {
    return { ok: false, problems: [{ path: '', code: 'DEFINITION_INVALID', message: 'a schedule must be an object' }] };
  }
  const ctx: Ctx = { problems: [], count: 0, tooDeep: false, walkStopped: false };
  const add = (path: string, code: string, message: string) => ctx.problems.push({ path, code, message });

  refuseBadText(input, '', 1, ctx);
  if (ctx.walkStopped || ctx.problems.length >= MAX_PROBLEMS) return { ok: false, problems: ctx.problems.slice(0, MAX_PROBLEMS) };
  refuseUnknown(input, TOP_KEYS, (k) => k, ctx);
  if (typeof input.name !== 'string' || input.name.trim() === '') add('name', 'NAME_REQUIRED', 'a schedule needs a name');
  if (input.description !== undefined && typeof input.description !== 'string') {
    add('description', 'DESCRIPTION_INVALID', 'description must be text');
  }

  const rec = parseRecurrence(input.recurrence);
  if (!rec.ok) {
    rec.unknownFields.forEach((f) => add(`recurrence.${f}`, 'UNKNOWN_FIELD', `unknown field: ${f}`));
    // The unknown fields come first in `problems`; each has its row above.
    rec.problems.slice(rec.unknownFields.length).forEach((m) => add('recurrence', 'RECURRENCE_INVALID', m));
  }

  const items: ScheduleItemInput[] = [];
  if (!Array.isArray(input.items) || input.items.length === 0) {
    add('items', 'ITEMS_REQUIRED', 'a schedule needs at least one workflow to start');
  } else {
    input.items.forEach((it, i) => {
      const parsed = parseItem(it, `items[${i}]`, 1, ctx);
      if (parsed) items.push(parsed);
    });
    if (ctx.count > MAX_SCHEDULE_ITEMS) {
      add('items', 'TOO_MANY_ITEMS', `a schedule holds at most ${MAX_SCHEDULE_ITEMS} workflows, chained ones included`);
    }
    if (ctx.tooDeep) add('items', 'TOO_DEEP', `chains go at most ${MAX_CHAIN_LEVELS} levels deep`);
  }

  if (ctx.problems.length > 0 || !rec.ok) return { ok: false, problems: ctx.problems.slice(0, MAX_PROBLEMS) };
  const value: ScheduleDefinition = { name: (input.name as string).trim(), recurrence: rec.value, items };
  if (typeof input.description === 'string') value.description = input.description;
  return { ok: true, value };
}
