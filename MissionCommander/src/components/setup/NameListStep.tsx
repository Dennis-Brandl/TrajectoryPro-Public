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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiErrorMessage } from '@/lib/api/client';
import { splitNames } from '@/lib/split-names';

/**
 * One first-run screen that creates a list of named things (work centers, roles). The box
 * takes one name or a comma-separated list. Names already created are skipped, ignoring
 * case. They are created one at a time in the order typed; on a failure the ones already
 * made stay made, and the failed name and those after it stay in the box to fix and retry.
 */
export function NameListStep({
  title, description, label, placeholder, examples = [], names, create, onCreated,
  required, nextLabel, onNext,
}: {
  title: string;
  description: string;
  label: string;
  placeholder: string;
  /** One-click chips; each adds that name. Hidden once the name exists. */
  examples?: readonly string[];
  /** The names created so far, in this run of setup or before a reload. */
  names: string[];
  create: (name: string) => Promise<unknown>;
  onCreated: (name: string) => void;
  /** At least one name before the next button is enabled. */
  required: boolean;
  nextLabel: string;
  onNext: () => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const has = (n: string) => names.some((x) => x.toLowerCase() === n.toLowerCase());

  const add = async (raw: string, fromBox: boolean) => {
    const wanted = splitNames(raw).filter((n) => !has(n));
    setError(null);
    if (wanted.length === 0) { if (fromBox) setText(''); return; }
    setBusy(true);
    let i = 0;
    try {
      for (; i < wanted.length; i++) {
        await create(wanted[i]);
        onCreated(wanted[i]);
      }
      if (fromBox) setText('');
    } catch (err) {
      setError(`Could not create "${wanted[i]}": ${apiErrorMessage(err, 'the server refused it')}`);
      if (fromBox) setText(wanted.slice(i).join(', '));
    } finally {
      setBusy(false);
    }
  };

  const chips = examples.filter((ex) => !has(ex));
  return (
    <form
      noValidate
      onSubmit={(e) => { e.preventDefault(); void add(text, true); }}
      className="w-96 space-y-4 rounded-[10px] border border-border p-6"
    >
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground">{description}</p>
      <div className="space-y-1">
        <Label htmlFor="setup-names">{label}</Label>
        <Input id="setup-names" value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} />
        <p className="text-xs text-muted-foreground">Enter one name, or several separated by commas.</p>
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <span className="self-center text-xs text-muted-foreground">Examples:</span>
          {chips.map((ex) => (
            <button
              key={ex}
              type="button"
              className="rounded-full border border-border px-3 py-0.5 text-xs hover:bg-accent disabled:opacity-50"
              onClick={() => void add(ex, false)}
              disabled={busy}
            >
              + {ex}
            </button>
          ))}
        </div>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" variant="outline" disabled={busy || splitNames(text).length === 0}>
        {busy ? 'Adding…' : 'Add'}
      </Button>
      {names.length > 0 && (
        <ul aria-label="Created" className="space-y-1">
          {names.map((n) => <li key={n} className="rounded border border-border px-3 py-1.5 text-sm">{n}</li>)}
        </ul>
      )}
      <div className="flex justify-end">
        <Button type="button" onClick={onNext} disabled={busy || (required && names.length === 0)}>{nextLabel}</Button>
      </div>
    </form>
  );
}
