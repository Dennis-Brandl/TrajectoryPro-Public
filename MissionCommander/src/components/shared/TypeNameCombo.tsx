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
import { forwardRef, type InputHTMLAttributes } from 'react';
import { Input } from '@/components/ui/input';

type TypeNameComboProps = { id: string; options: readonly string[] } & InputHTMLAttributes<HTMLInputElement>;

// Free-text input with a datalist of suggestions (nothing validates against the list).
export const TypeNameCombo = forwardRef<HTMLInputElement, TypeNameComboProps>(function TypeNameCombo(
  { id, options, ...rest }, ref,
) {
  return (
    <>
      <Input id={id} ref={ref} list={`${id}-options`} placeholder="None" autoComplete="off" {...rest} />
      <datalist id={`${id}-options`}>
        {options.map((o) => <option key={o} value={o} />)}
      </datalist>
    </>
  );
});
