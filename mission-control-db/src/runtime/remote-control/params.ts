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

import { REMOTE_CODES, RemoteError } from './codes.js';

const bad = (why: string) => new RemoteError(REMOTE_CODES.INVALID_INPUT, `Starting parameters ${why}`);

function scalar(v: unknown, name: string): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  throw bad(`value of "${name}" must be text`);
}

/** Ruling R2: three accepted forms (blank = none).
 *  1. The Value Type form — a whole Value Property, which the engine sends as [{name, value}]
 *     (MissionEngine properties.ts group resolution). The Description entry is annotation, never data.
 *  2. A JSON object {"Batch":"B-17"}.
 *  3. name=value pairs separated by ";" ("Batch=B-17; Qty=40").
 *  Unknown names are rejected later, against the master's own starting parameters. */
export function parseStartingParameters(raw: string): Record<string, string> {
  const text = raw.trim();
  if (text === '') return {};
  if (text.startsWith('[') || text.startsWith('{')) {
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { throw bad('are not valid JSON'); }
    const out: Record<string, string> = {};
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        const name = (item as { name?: unknown } | null)?.name;
        if (!item || typeof item !== 'object' || typeof name !== 'string' || !('value' in item)) {
          throw bad('list must contain {"name", "value"} entries');
        }
        if (name.trim().toLowerCase() === 'description') continue;
        out[name.trim()] = scalar((item as { value: unknown }).value, name);
      }
      return out;
    }
    if (parsed && typeof parsed === 'object') {
      for (const [name, value] of Object.entries(parsed)) out[name.trim()] = scalar(value, name);
      return out;
    }
    throw bad('must be a JSON object or list');
  }
  const out: Record<string, string> = {};
  for (const segment of text.split(';')) {
    if (segment.trim() === '') continue;
    const eq = segment.indexOf('=');
    if (eq < 0) throw bad(`"${segment.trim()}" is not name=value`);
    const name = segment.slice(0, eq).trim();
    if (name === '') throw bad(`"${segment.trim()}" has no name`);
    out[name] = segment.slice(eq + 1).trim();
  }
  return out;
}
