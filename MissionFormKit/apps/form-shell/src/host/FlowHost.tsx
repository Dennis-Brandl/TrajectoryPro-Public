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
import { FormDocumentView } from '@mission/form-renderer'
import type { FormEngine } from '../engine/FormEngine'
import { useFlowHost } from './useFlowHost'
import { StepBar } from '../chrome/StepBar'
import { CompletionScreen } from '../chrome/CompletionScreen'
import { EventLogPanel } from '../chrome/EventLogPanel'
import { resolveImage } from '../resolveImage'

export function FlowHost({ engine }: { engine: FormEngine }) {
  const host = useFlowHost(engine)
  return (
    <div className="fs-host">
      <div className="fs-stage">
        <StepBar
          step={host.step}
          canGoBack={host.canGoBack}
          onBack={host.back}
          missingCount={host.gate.missing.length}
        />
        {host.done ? (
          <CompletionScreen values={host.values} onRestart={host.restart} />
        ) : (
          <FormDocumentView
            // Per step INSTANCE, not per step: a workflow loop re-enters the same
            // screenId, and only a remount clears the previous cure. HOST-CONTRACT §3.
            key={host.current.instanceId}
            document={host.current.document}
            mode="run"
            values={host.values}
            signature={host.signature}
            onEvent={host.onEvent}
            images={resolveImage}
          />
        )}
      </div>
      <EventLogPanel entries={host.log} />
    </div>
  )
}
