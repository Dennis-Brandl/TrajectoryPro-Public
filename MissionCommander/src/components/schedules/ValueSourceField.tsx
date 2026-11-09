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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from './form-controls';
import type { ValueSource } from './master-schedule-model';

// One starting parameter's value: a source selector and the field that source needs (spec §5.6).

type Kind = 'value' | 'trigger' | 'occurrence.date' | 'occurrence.datetime' | 'occurrence.number' | 'template';

const KIND_LABEL: Record<Kind, string> = {
  value: 'Fixed value', trigger: 'From triggering run', 'occurrence.date': 'Scheduled date',
  'occurrence.datetime': 'Scheduled date and time', 'occurrence.number': 'Slot number', template: 'Template',
};

function kindOf(s: ValueSource | undefined): Kind {
  if (!s || 'value' in s) return 'value';
  if ('template' in s) return 'template';
  return s.from === 'trigger.input' || s.from === 'trigger.output' ? 'trigger' : s.from;
}

export type TriggerChoices = { inputs: string[]; outputs: string[] };

export function ValueSourceField({ id, description, source, defaultValue = '', placeholder, parent, notAParameter, problem, onChange, onRemove }: {
  id: string;
  description?: string | null;
  source: ValueSource | undefined;
  /** The workflow's literal default, offered when the source goes back to Fixed value. */
  defaultValue?: string;
  placeholder?: string;
  /** What "From triggering run" can read; null on a start-list item, which has no triggering run. */
  parent: TriggerChoices | null;
  /** The workflow has no such parameter (it was removed, or the workflow changed). */
  notAParameter?: boolean;
  problem?: string;
  onChange: (s: ValueSource) => void;
  onRemove?: () => void;
}) {
  const kind = kindOf(source);
  const kinds = (Object.keys(KIND_LABEL) as Kind[]).filter((k) => k !== 'trigger' || parent !== null);

  const pickKind = (k: Kind) => {
    if (k === kind) return;
    if (k === 'value') onChange({ value: defaultValue });
    else if (k === 'trigger') onChange({ from: 'trigger.input', name: '' });
    else if (k === 'template') onChange({ template: '' });
    else onChange({ from: k });
  };
  const fallback = source && !('value' in source) ? source.fallback ?? '' : '';
  const withFallback = (text: string) => {
    if (!source || 'value' in source) return;
    const { fallback: _old, ...rest } = source;
    onChange((text === '' ? rest : { ...rest, fallback: text }) as ValueSource);
  };

  const trig = source && 'from' in source && (source.from === 'trigger.input' || source.from === 'trigger.output')
    ? { from: source.from, name: source.name } : null;
  const triggerValue = trig && trig.name !== '' ? `${trig.from}:${trig.name}` : '';
  const lost = (from: 'trigger.input' | 'trigger.output') =>
    trig !== null && trig.from === from && trig.name !== '' && !(from === 'trigger.input' ? parent?.inputs : parent?.outputs)?.includes(trig.name);

  return (
    <div className="space-y-1 rounded-md border p-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-32 text-sm font-medium" title={description ?? undefined}>{id}</div>
        <NativeSelect aria-label={`Source for ${id}`} value={kind} onChange={(e) => pickKind(e.target.value as Kind)}>
          {kinds.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </NativeSelect>
        {kind === 'value' && (
          <Input aria-label={`Value for ${id}`} className="w-56" placeholder={placeholder} value={source && 'value' in source ? source.value : ''}
            onChange={(e) => onChange({ value: e.target.value })} />
        )}
        {kind === 'trigger' && parent && (
          <NativeSelect aria-label={`Triggering run value for ${id}`} value={triggerValue}
            onChange={(e) => {
              const [from, ...name] = e.target.value.split(':');
              if (from === 'trigger.input' || from === 'trigger.output') {
                onChange({ from, name: name.join(':'), ...(fallback !== '' ? { fallback } : {}) });
              }
            }}>
            <option value="" disabled>Choose a value</option>
            <optgroup label="Starting values">
              {parent.inputs.map((n) => <option key={n} value={`trigger.input:${n}`}>{n}</option>)}
              {lost('trigger.input') && <option value={triggerValue}>{trig!.name} (not found)</option>}
            </optgroup>
            <optgroup label="Outputs">
              {parent.outputs.map((n) => <option key={n} value={`trigger.output:${n}`}>{n}</option>)}
              {lost('trigger.output') && <option value={triggerValue}>{trig!.name} (not found)</option>}
            </optgroup>
          </NativeSelect>
        )}
        {kind === 'template' && (
          <Input aria-label={`Template for ${id}`} className="w-72" placeholder="B-{occurrence.date}-{occurrence.number}"
            value={source && 'template' in source ? source.template : ''}
            onChange={(e) => onChange({ template: e.target.value, ...(fallback !== '' ? { fallback } : {}) })} />
        )}
        {kind !== 'value' && (
          <Input aria-label={`Fallback for ${id}`} className="w-40" placeholder="Fallback if empty" value={fallback}
            onChange={(e) => withFallback(e.target.value)} />
        )}
        {onRemove && <Button type="button" variant="outline" size="sm" aria-label={`Remove value for ${id}`} onClick={onRemove}>Remove</Button>}
      </div>
      {notAParameter && <p className="text-xs text-amber-600 dark:text-amber-400">Not a parameter of this workflow.</p>}
      {problem && <p className="text-xs text-destructive">{problem}</p>}
    </div>
  );
}
