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

import type { WorkCenter } from '../api/types'
import { WorkCenterList } from '../frame/WorkCenterList'

export interface WorkCenterPickerProps {
  onSelect(wc: WorkCenter): void
  onSignOut(): void
  signingOut?: boolean
}

export function WorkCenterPicker({ onSelect, onSignOut, signingOut = false }: WorkCenterPickerProps) {
  return (
    <main className="picker">
      <h1 className="picker-title">Choose a work center</h1>
      <WorkCenterList onChoose={onSelect} />
      <button type="button" onClick={onSignOut} disabled={signingOut}>
        {signingOut ? 'Signing out…' : 'Sign Out'}
      </button>
    </main>
  )
}
