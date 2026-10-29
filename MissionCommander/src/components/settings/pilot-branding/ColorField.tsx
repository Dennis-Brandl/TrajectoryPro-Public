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

// One colour of the Pilot theme: typed hex (the source of truth), a picker, a reset to
// default and the field's provenance (spec 2026-10-09 §9). An invalid entry never reaches
// the draft — the preview keeps the last good value and the editor disables Save.
import { useState } from 'react';
import { parseHexInput, type Provenance } from './theme-draft';

export interface ColorFieldProps {
  id: string;
  label: string;
  /** The draft's value; null = inherit. */
  value: string | null;
  /** What applies now (the inherited or automatic colour): placeholder and picker fallback. */
  effective: string;
  provenance: Provenance;
  disabled: boolean;
  onChange(value: string | null): void;
  onValidity(id: string, valid: boolean): void;
}

export function ColorField(p: ColorFieldProps) {
  const [text, setText] = useState(p.value ?? '');
  // Adjust-state-during-render: a value changed from outside (a reset) replaces the text.
  const [seen, setSeen] = useState(p.value);
  if (p.value !== seen) {
    setSeen(p.value);
    setText(p.value ?? '');
  }
  const parsed = parseHexInput(text);
  const swatch = parsed.ok ? (parsed.value ?? p.effective) : p.effective;

  const accept = (next: string) => {
    setText(next);
    const r = parseHexInput(next);
    p.onValidity(p.id, r.ok);
    if (r.ok) p.onChange(r.value);
  };

  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        aria-label={`${p.label} colour picker`}
        value={swatch}
        disabled={p.disabled}
        onChange={(e) => accept(e.target.value)}
        className="h-8 w-10 shrink-0 cursor-pointer rounded border bg-background p-0.5 disabled:cursor-not-allowed"
      />
      <input
        id={p.id}
        aria-label={p.label}
        aria-describedby={`${p.id}-provenance`}
        aria-invalid={parsed.ok ? undefined : true}
        value={text}
        placeholder={p.effective}
        disabled={p.disabled}
        spellCheck={false}
        onChange={(e) => accept(e.target.value)}
        className="w-28 rounded border bg-background px-2 py-1 font-mono text-sm aria-[invalid=true]:border-destructive"
      />
      {p.value !== null && !p.disabled && (
        <button
          type="button"
          aria-label={`Reset ${p.label}`}
          title="Reset to default"
          className="rounded px-1 text-muted-foreground hover:text-foreground"
          onClick={() => {
            p.onValidity(p.id, true);
            p.onChange(null);
          }}
        >
          ↺
        </button>
      )}
      <span id={`${p.id}-provenance`} className="text-xs text-muted-foreground">{p.provenance}</span>
      {!parsed.ok && <span className="text-xs text-destructive">Use #rrggbb</span>}
    </div>
  );
}
