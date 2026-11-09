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
import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';

// Small controls the Master Schedule editor shares. A native <select> is used where the options are a
// short fixed list: it is keyboard-complete and reads well for screen readers.

export const SELECT_CLASS =
  'h-9 rounded-md border border-input bg-background px-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

export function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cn(SELECT_CLASS, className)} {...props} />;
}

/** A whole-number field that lets the box be empty while typing; it reports only valid numbers. */
export function NumField({ label, value, onChange, min = 1, max, className }: {
  label: string; value: number; onChange: (n: number) => void; min?: number; max?: number; className?: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText((t) => (Number(t) === value ? t : String(value))); }, [value]);
  return (
    <Input type="number" aria-label={label} className={cn('w-20', className)} min={min} max={max} value={text}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value !== '' && Number.isInteger(n) && n >= min && (max === undefined || n <= max)) onChange(n);
      }} />
  );
}

/** A radio with its label beside it. */
export function RadioRow({ name, label, checked, onSelect, children }: {
  name: string; label: string; checked: boolean; onSelect: () => void; children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-2 text-sm">
        <input type="radio" name={name} checked={checked} onChange={onSelect} />
        {label}
      </label>
      {children}
    </div>
  );
}
