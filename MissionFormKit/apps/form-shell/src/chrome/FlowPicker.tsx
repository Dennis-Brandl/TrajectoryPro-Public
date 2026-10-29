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
export interface FlowPickerOption {
  id: string
  label: string
}

export interface FlowPickerProps {
  options: FlowPickerOption[]
  activeId: string
  onSelect: (id: string) => void
}

export function FlowPicker({ options, activeId, onSelect }: FlowPickerProps) {
  return (
    <div className="fs-picker">
      {options.map((o) => (
        <button key={o.id} type="button" onClick={() => onSelect(o.id)} disabled={o.id === activeId}>
          {o.label}
        </button>
      ))}
    </div>
  )
}
