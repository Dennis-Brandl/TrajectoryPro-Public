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

export type Param = { name: string; value: string };

function asList(raw: string): Param[] | null {
  const t = raw.trim();
  if (!t.startsWith('[')) return null;
  try {
    const parsed: unknown = JSON.parse(t);
    if (!Array.isArray(parsed)) return null;
    const out: Param[] = [];
    for (const item of parsed) {
      const { name, value } = (item ?? {}) as { name?: unknown; value?: unknown };
      if (typeof name !== 'string' || typeof value !== 'string') return null;
      out.push({ name, value });
    }
    return out;
  } catch { return null; }
}

function rawParam(params: Param[], param: string): string | undefined {
  return (params.find((p) => p.name === param) ?? params.find((p) => p.name.toLowerCase() === param.toLowerCase()))?.value;
}

/** An action input is one Value Property (Designer exports one spec per property). The engine
 *  sends a plain string when the step binds an entry ("Child.ID") or a literal, and the
 *  [{name, value}] list when it binds the whole property ("Child"). Either way, return `entry`. */
export function readInput(params: Param[], param: string, entry: string): string {
  const raw = rawParam(params, param);
  if (raw === undefined) return '';
  const list = asList(raw);
  if (!list) return raw;
  return (list.find((e) => e.name === entry) ?? list.find((e) => e.name.toLowerCase() === entry.toLowerCase()))?.value ?? '';
}

/** Ruling R2 + plan decision: the library's own StartingParameters{Value} property unwraps to its
 *  text; any other whole-property list is itself the parameter list (the Value Type form). */
export function readStartingParameters(params: Param[], param = 'StartingParameters'): string {
  const raw = rawParam(params, param);
  if (raw === undefined) return '';
  const list = asList(raw);
  if (list && list.length === 1 && list[0].name.toLowerCase() === 'value') return list[0].value;
  return raw;
}

/** One output Value Property in the Value Type list form; the engine writes it entry by entry. */
export function group(entries: Record<string, string>): string {
  return JSON.stringify(Object.entries(entries).map(([name, value]) => ({ name, value })));
}

export function completionOutputs(code: number, text: string): Param[] {
  return [
    { name: 'Completion', value: group({ Code: String(code) }) },
    { name: 'Error', value: group({ Text: text }) },
  ];
}
