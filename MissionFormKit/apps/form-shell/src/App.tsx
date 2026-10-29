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
import { useMemo, useState } from 'react'
import { FLOWS, DEFAULT_FLOW_ID } from './flows'
import { FlowPicker } from './chrome/FlowPicker'
import { FlowHost } from './host/FlowHost'

export function App() {
  const [activeId, setActiveId] = useState(DEFAULT_FLOW_ID)
  const entry = FLOWS.find((f) => f.id === activeId) ?? FLOWS[0]!
  const engine = useMemo(() => entry.createEngine(), [entry])
  return (
    <div className="fs-app">
      <FlowPicker
        options={FLOWS.map((f) => ({ id: f.id, label: f.label }))}
        activeId={activeId}
        onSelect={setActiveId}
      />
      <FlowHost key={activeId} engine={engine} />
    </div>
  )
}
