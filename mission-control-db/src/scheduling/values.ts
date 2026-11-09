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

// Starting-value sources for scheduled workflows (spec section 5.6). Pure: no
// database access. Every source resolves to a string, as all starting parameters do.

import { DateTime } from 'luxon';
import type { Slot } from './recurrence.js';

export type ValueSource =
  | { value: string }
  | { from: 'trigger.input' | 'trigger.output'; name: string; fallback?: string }
  | { from: 'occurrence.date' | 'occurrence.datetime' | 'occurrence.number'; fallback?: string }
  | { template: string; fallback?: string };

export type ResolveContext = {
  slot: Slot;
  zone: string;
  /** The triggering run's starting values and outputs, keyed by parameter id; null on a start-list item. */
  trigger: { inputs: Record<string, string>; outputs: Record<string, string> } | null;
};

const OCCURRENCE_FROM = ['occurrence.date', 'occurrence.datetime', 'occurrence.number'] as const;
const TRIGGER_FROM = ['trigger.input', 'trigger.output'] as const;
const PLACEHOLDER = /\{([^{}]*)\}/g;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// ------------------------------------------------------------------ parsing

/** Placeholder names in `template`, in order. */
function placeholders(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER)].map((m) => m[1] as string);
}

function placeholderProblem(name: string, allowTrigger: boolean): string | null {
  if ((OCCURRENCE_FROM as readonly string[]).includes(name)) return null;
  const m = /^trigger\.(input|output)\.(.+)$/.exec(name);
  if (!m) return `unknown placeholder {${name}}`;
  if (!allowTrigger) return `{${name}} needs a triggering run, which a start-list item does not have`;
  return null;
}

/**
 * Validate one value source. `allowTrigger` is false for start-list items. Returns a
 * normalized copy (only known keys) or one plain-words message.
 */
export function parseValueSource(
  input: unknown,
  allowTrigger: boolean,
): { ok: true; value: ValueSource } | { ok: false; message: string } {
  const bad = (message: string) => ({ ok: false as const, message });
  if (!isRecord(input)) return bad('a value source must be an object');
  const forms = (['value', 'from', 'template'] as const).filter((k) => input[k] !== undefined);
  if (forms.length !== 1) return bad('needs exactly one of value, from, template');
  const form = forms[0] as 'value' | 'from' | 'template';
  const allowed =
    form === 'value'
      ? ['value']
      : form === 'template'
        ? ['template', 'fallback']
        : input.from === 'trigger.input' || input.from === 'trigger.output'
          ? ['from', 'name', 'fallback']
          : ['from', 'fallback'];
  const unknownKey = Object.keys(input).find((k) => !allowed.includes(k));
  if (unknownKey) return bad(`unknown key: ${unknownKey}`);
  if (input.fallback !== undefined && typeof input.fallback !== 'string') return bad('fallback must be text');
  const fallback = input.fallback as string | undefined;
  const withFallback = <T extends object>(v: T): T & { fallback?: string } =>
    fallback === undefined ? v : { ...v, fallback };

  if (form === 'value') {
    if (typeof input.value !== 'string') return bad('value must be text');
    return { ok: true, value: { value: input.value } };
  }
  if (form === 'template') {
    if (typeof input.template !== 'string') return bad('template must be text');
    for (const name of placeholders(input.template)) {
      const problem = placeholderProblem(name, allowTrigger);
      if (problem) return bad(problem);
    }
    return { ok: true, value: withFallback({ template: input.template }) };
  }
  const from = input.from;
  if ((TRIGGER_FROM as readonly unknown[]).includes(from)) {
    if (!allowTrigger) return bad(`${String(from)} needs a triggering run, which a start-list item does not have`);
    if (typeof input.name !== 'string' || input.name === '') return bad(`${String(from)} needs a name`);
    return {
      ok: true,
      value: withFallback({ from: from as (typeof TRIGGER_FROM)[number], name: input.name }),
    };
  }
  if ((OCCURRENCE_FROM as readonly unknown[]).includes(from)) {
    return { ok: true, value: withFallback({ from: from as (typeof OCCURRENCE_FROM)[number] }) };
  }
  return bad(`unknown source: ${String(from)}`);
}

// --------------------------------------------------------------- resolution

type Resolved = { ok: true; value: string } | { ok: false; reason: string };

const noValue = (name: string): Resolved => ({ ok: false, reason: `${name} has no value from the triggering run` });

function occurrenceValue(from: (typeof OCCURRENCE_FROM)[number], ctx: ResolveContext): string {
  if (from === 'occurrence.number') return String(ctx.slot.number);
  const local = DateTime.fromJSDate(ctx.slot.at, { zone: ctx.zone });
  return from === 'occurrence.date' ? local.toFormat('yyyy-MM-dd') : local.toFormat("yyyy-MM-dd'T'HH:mm");
}

function triggerValue(kind: 'input' | 'output', name: string, ctx: ResolveContext): string {
  const map = ctx.trigger ? (kind === 'input' ? ctx.trigger.inputs : ctx.trigger.outputs) : {};
  return Object.hasOwn(map, name) ? (map[name] ?? '') : '';
}

function resolveOne(src: ValueSource, ctx: ResolveContext): Resolved {
  if ('value' in src) return { ok: true, value: src.value };
  const empty = (name: string): Resolved =>
    src.fallback !== undefined ? { ok: true, value: src.fallback } : noValue(name);

  if ('template' in src) {
    let missing: string | null = null;
    const text = src.template.replace(PLACEHOLDER, (_all, name: string) => {
      const m = /^trigger\.(input|output)\.(.+)$/.exec(name);
      const v = m
        ? triggerValue(m[1] as 'input' | 'output', m[2] as string, ctx)
        : occurrenceValue(name as (typeof OCCURRENCE_FROM)[number], ctx);
      if (v === '' && missing === null) missing = m ? (m[2] as string) : name;
      return v;
    });
    return missing === null ? { ok: true, value: text } : empty(missing);
  }
  if (src.from === 'trigger.input' || src.from === 'trigger.output') {
    const v = triggerValue(src.from === 'trigger.input' ? 'input' : 'output', src.name, ctx);
    return v === '' ? empty(src.name) : { ok: true, value: v };
  }
  return { ok: true, value: occurrenceValue(src.from, ctx) };
}

/** Resolve every starting parameter, or report the first one that has no value. */
export function resolveParams(
  params: Record<string, ValueSource>,
  ctx: ResolveContext,
): { ok: true; values: Record<string, string> } | { ok: false; reason: string } {
  const values: Record<string, string> = {};
  for (const [id, src] of Object.entries(params)) {
    const r = resolveOne(src, ctx);
    if (!r.ok) return r;
    values[id] = r.value;
  }
  return { ok: true, values };
}
