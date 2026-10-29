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

import { useConnections } from '../../store/connections'
import styles from './ConnectionList.module.css'

export function ConnectionList() {
  const { state, selectConnection } = useConnections()

  if (state.connections.length === 0) {
    return (
      <p className={styles.empty}>
        No connections yet. Open the connections menu in the top bar and choose{' '}
        <strong>+ Add connection</strong>.
      </p>
    )
  }

  return (
    <ul className={styles.list}>
      {state.connections.map((c) => {
        const isActive = c.id === state.activeConnectionId
        const label = c.name?.trim() ? c.name : c.url
        return (
          <li key={c.id}>
            <button
              type="button"
              data-testid={`sidebar-conn-${c.id}`}
              className={[styles.row, isActive ? styles.rowActive : ''].join(' ').trim()}
              onClick={() => selectConnection(c.id)}
            >
              <span className={styles.label}>{label}</span>
              <span className={styles.url}>{c.url}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
