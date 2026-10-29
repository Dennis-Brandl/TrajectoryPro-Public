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
import { pillVariantForState } from '../../lib/state-pill'
import { useActiveConnection } from '../../store/connections'
import { useActiveInstance, useTrackedInstances } from '../../store/active-instance'
import styles from './InstanceList.module.css'

export function InstanceList() {
  const connection = useActiveConnection()
  const tracked = useTrackedInstances(connection?.id)
  const { state, selectInstance } = useActiveInstance()

  if (!connection) {
    return <p className={styles.message}>No active connection.</p>
  }
  if (tracked.length === 0) {
    return <p className={styles.message}>No instances yet. Invoke an action to start.</p>
  }

  return (
    <ul className={styles.list}>
      {tracked.map((t) => {
        const isActive =
          state.selection?.type === 'instance' && state.selection.instance_id === t.instance_id
        const stateLabel = t.last_known_state ?? '—'
        return (
          <li key={t.instance_id}>
            <button
              type="button"
              data-testid={`instance-row-${t.instance_id}`}
              className={[styles.row, isActive ? styles.rowActive : ''].join(' ').trim()}
              onClick={() => selectInstance(t.instance_id)}
            >
              <span className={styles.id}>{t.instance_id.slice(0, 8)}</span>
              <Pill variant={pillVariantForState(t.last_known_state)}>{stateLabel}</Pill>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
