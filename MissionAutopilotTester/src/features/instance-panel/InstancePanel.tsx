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

import { Pill } from '../../components/Pill'
import { useActiveInstance } from '../../store/active-instance'
import { useCapabilities } from '../../store/use-capabilities'
import { useInstanceStream } from '../../store/use-instance-stream'
import { pillVariantForState } from '../../lib/state-pill'
import { StateTimeline } from './StateTimeline'
import { CommandBar } from './CommandBar'
import { OutputsView } from './OutputsView'
import { ErrorPanel } from './ErrorPanel'
import type { Command } from '../../api/types'
import styles from './InstancePanel.module.css'

export function InstancePanel() {
  const { state } = useActiveInstance()
  const selection = state.selection
  const instanceId = selection?.type === 'instance' ? selection.instance_id : null

  const capabilities = useCapabilities()
  const stream = useInstanceStream(instanceId)

  if (!instanceId) return null

  if (stream.isLoading) {
    return <p className={styles.message}>Loading instance…</p>
  }
  if (stream.isError) {
    return <p className={styles.error}>Failed to load instance: {stream.error?.message}</p>
  }
  if (!stream.data) return null

  const live = stream.data

  // Look up the action capability — gives us supported_commands.
  const trackedInstance = state.trackedInstances.find((t) => t.instance_id === instanceId)
  const action = (() => {
    const envs = capabilities.data?.data.environments ?? []
    for (const env of envs) {
      const found = env.actions.find((a) => a.action_oid === trackedInstance?.action_oid)
      if (found) return found
    }
    return undefined
  })()

  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <h2 className={styles.title}>{live.instance_id}</h2>
        <div className={styles.headerRight}>
          <Pill variant={pillVariantForState(live.current_state)}>{live.current_state}</Pill>
          <span
            className={[styles.dot, stream.isConnected ? styles.dotOk : styles.dotBad]
              .join(' ')
              .trim()}
            aria-label={stream.isConnected ? 'connected' : 'disconnected'}
            title={stream.isConnected ? 'Live stream connected' : 'Live stream disconnected'}
          />
        </div>
      </header>

      <section className={styles.section} aria-label="State timeline">
        <h3 className={styles.sectionHeading}>State</h3>
        <StateTimeline
          history={live.state_history}
          terminal={live.terminal}
        />
      </section>

      <section className={styles.section} aria-label="Commands">
        <h3 className={styles.sectionHeading}>Commands</h3>
        {action ? (
          <CommandBar
            instanceId={live.instance_id}
            visibility={live.visibility}
            currentState={live.current_state}
            supportedCommands={action.supported_commands as readonly Command[]}
          />
        ) : capabilities.isLoading ? (
          <p className={styles.sectionMessage}>Loading commands…</p>
        ) : (
          <p className={styles.sectionMessage}>
            Action capability not found for OID {trackedInstance?.action_oid ?? '(unknown)'}.
          </p>
        )}
      </section>

      <section className={styles.section} aria-label="Outputs">
        <h3 className={styles.sectionHeading}>Outputs</h3>
        <OutputsView outputs={live.outputs} />
      </section>

      <ErrorPanel
        terminalError={live.terminal_error}
        latestError={live.latest_error}
        latestTraceback={live.latest_traceback}
      />
    </div>
  )
}
