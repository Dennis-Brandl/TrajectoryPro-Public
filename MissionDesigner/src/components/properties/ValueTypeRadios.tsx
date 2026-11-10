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

interface ValueTypeRadiosProps {
  /** Radio-group name; must be unique on the page (e.g. `valueType-<id>`). */
  name: string
  /** True when the value comes from a Source (property), false for Text (a fixed value). */
  isProperty: boolean
  onChange: (valueType: 'literal' | 'property') => void
  disabled?: boolean
}

/**
 * The Text / Source radio pair used wherever a value is either typed in or read
 * from a property — Input Parameters and Count Limited resource-command counts.
 */
export function ValueTypeRadios({ name, isProperty, onChange, disabled = false }: ValueTypeRadiosProps) {
  return (
    <>
      <label className="flex items-center gap-1 cursor-pointer shrink-0">
        <input
          type="radio"
          name={name}
          checked={!isProperty}
          onChange={() => onChange('literal')}
          className="h-3 w-3 accent-muted-foreground"
          disabled={disabled}
        />
        <span className="text-xs text-muted-foreground">Text</span>
      </label>
      <label className="flex items-center gap-1 cursor-pointer shrink-0">
        <input
          type="radio"
          name={name}
          checked={isProperty}
          onChange={() => onChange('property')}
          className="h-3 w-3 accent-muted-foreground"
          disabled={disabled}
        />
        <span className="text-xs text-muted-foreground">Source</span>
      </label>
    </>
  )
}
