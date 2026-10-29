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

import { useMemo } from 'react'
import { Pill } from '../../components/Pill'
import { useActiveInstance } from '../../store/active-instance'
import { useCapabilities } from '../../store/use-capabilities'
import { useActiveConnection } from '../../store/connections'
import type { ActionCapability, EnvironmentCapability } from '../../api/types'
import styles from './ActionTree.module.css'

function groupByVisibility(actions: ActionCapability[]): {
  observable: ActionCapability[]
  opaque: ActionCapability[]
} {
  const observable: ActionCapability[] = []
  const opaque: ActionCapability[] = []
  for (const a of actions) {
    if (a.visibility === 'observable') observable.push(a)
    else opaque.push(a)
  }
  return { observable, opaque }
}

interface EnvSectionProps {
  env: EnvironmentCapability
  selectedActionOid: string | undefined
  onSelectAction: (oid: string) => void
}

function EnvSection({ env, selectedActionOid, onSelectAction }: EnvSectionProps) {
  const grouped = useMemo(() => groupByVisibility(env.actions), [env.actions])

  const renderRow = (a: ActionCapability) => {
    const isActive = selectedActionOid === a.action_oid
    return (
      <li key={a.action_oid}>
        <button
          type="button"
          data-testid={`action-row-${a.action_oid}`}
          className={[styles.row, isActive ? styles.rowActive : ''].join(' ').trim()}
          onClick={() => onSelectAction(a.action_oid)}
        >
          <span className={styles.label}>{a.local_id}</span>
          <Pill variant={a.visibility === 'observable' ? 'accent' : 'muted'}>{a.visibility}</Pill>
        </button>
      </li>
    )
  }

  return (
    <div className={styles.envGroup}>
      <h3 className={styles.envHeader}>
        <span>{env.environment_name}</span>
        <Pill variant="muted">{env.environment_state}</Pill>
      </h3>
      {grouped.observable.length > 0 && (
        <div className={styles.group}>
          <h4 className={styles.groupHeader}>Observable</h4>
          <ul className={styles.list}>{grouped.observable.map(renderRow)}</ul>
        </div>
      )}
      {grouped.opaque.length > 0 && (
        <div className={styles.group}>
          <h4 className={styles.groupHeader}>Opaque</h4>
          <ul className={styles.list}>{grouped.opaque.map(renderRow)}</ul>
        </div>
      )}
    </div>
  )
}

export function ActionTree() {
  const connection = useActiveConnection()
  const capabilities = useCapabilities()
  const { state, selectAction } = useActiveInstance()

  const environments = capabilities.data?.data.environments ?? []
  const totalActions = environments.reduce((n, e) => n + e.actions.length, 0)

  const selectedActionOid =
    state.selection?.type === 'action' ? state.selection.action_oid : undefined

  if (!connection) {
    return <p className={styles.message}>No active connection.</p>
  }
  if (capabilities.isPending && capabilities.fetchStatus === 'fetching') {
    return <p className={styles.message}>Loading actions…</p>
  }
  if (capabilities.isError) {
    return <p className={styles.error}>Failed to load actions.</p>
  }
  if (totalActions === 0) {
    return <p className={styles.message}>No actions on this container.</p>
  }

  return (
    <div className={styles.tree}>
      {environments.map((env) => (
        <EnvSection
          key={env.environment_oid}
          env={env}
          selectedActionOid={selectedActionOid}
          onSelectAction={selectAction}
        />
      ))}
    </div>
  )
}
