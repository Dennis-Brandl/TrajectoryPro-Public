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

import { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/Button'
import { useConnections } from '../../store/connections'
import { useCapabilities } from '../../store/use-capabilities'
import type { Connection } from '../../api/types'
import { ConnectionModal } from './ConnectionModal'
import styles from './ConnectionBar.module.css'

type DotStatus = 'idle' | 'connecting' | 'connected' | 'disconnected'

function connectionLabel(c: Connection | null): string {
  if (!c) return 'No connection'
  return c.name?.trim() ? c.name : c.url
}

export function ConnectionBar() {
  const { state, selectConnection, deleteConnection } = useConnections()
  const capabilities = useCapabilities()

  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!dropdownOpen) return
    const handleClickOutside = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [dropdownOpen])

  const active = state.connections.find((c) => c.id === state.activeConnectionId) ?? null

  let status: DotStatus
  if (!active) status = 'idle'
  else if (capabilities.isFetching) status = 'connecting'
  else if (capabilities.isError) status = 'disconnected'
  else if (capabilities.isSuccess) status = 'connected'
  else status = 'connecting'

  const handleRowSelect = (id: string) => {
    selectConnection(id)
    setDropdownOpen(false)
  }

  return (
    <div className={styles.bar} ref={rootRef}>
      <button
        type="button"
        className={styles.trigger}
        data-testid="connection-trigger"
        onClick={() => setDropdownOpen((open) => !open)}
        aria-haspopup="menu"
        aria-expanded={dropdownOpen}
      >
        <span
          className={[styles.dot, styles[status]].join(' ')}
          data-testid="connection-status-dot"
          aria-label={`status: ${status}`}
        />
        <span className={styles.label}>{connectionLabel(active)}</span>
        <span className={styles.caret} aria-hidden>
          ▾
        </span>
      </button>

      {dropdownOpen && (
        <div className={styles.dropdown} role="menu">
          {state.connections.length === 0 && (
            <p className={styles.empty}>No connections yet.</p>
          )}
          {state.connections.map((c) => (
            <div
              key={c.id}
              data-testid={`connection-row-${c.id}`}
              className={[
                styles.row,
                c.id === state.activeConnectionId ? styles.rowActive : '',
              ].join(' ').trim()}
            >
              <button
                type="button"
                className={styles.rowSelect}
                onClick={() => handleRowSelect(c.id)}
              >
                <span className={styles.rowLabel}>{connectionLabel(c)}</span>
                <span className={styles.rowUrl}>{c.url}</span>
              </button>
              <div className={styles.rowActions}>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setEditingId(c.id)
                    setDropdownOpen(false)
                  }}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  data-testid={`delete-${c.id}`}
                  onClick={() => deleteConnection(c.id)}
                >
                  Delete
                </Button>
              </div>
            </div>
          ))}
          <div className={styles.addRow}>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setShowAddModal(true)
                setDropdownOpen(false)
              }}
            >
              + Add connection
            </Button>
          </div>
        </div>
      )}

      <ConnectionModal open={showAddModal} onClose={() => setShowAddModal(false)} />
      <ConnectionModal
        key={editingId ?? 'none'}
        open={editingId !== null}
        onClose={() => setEditingId(null)}
        {...(editingId !== null ? { editingId } : {})}
      />
    </div>
  )
}
