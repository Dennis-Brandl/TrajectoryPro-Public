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

import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { Button } from '../../components/Button'
import { Pill } from '../../components/Pill'
import { TextInput } from '../../components/TextInput'
import { useActiveInstance } from '../../store/active-instance'
import { useCapabilities } from '../../store/use-capabilities'
import { useInvoke } from '../../store/use-invoke'
import type { ActionCapability, InputParameterSpec } from '../../api/types'
import styles from './InvokePanel.module.css'

function defaultValueAsString(spec: InputParameterSpec): string {
  return spec.default_value ?? ''
}

export function InvokePanel() {
  const { state } = useActiveInstance()
  const capabilities = useCapabilities()
  const invoke = useInvoke()

  const selection = state.selection
  const actionWithEnv: { action: ActionCapability; environmentOid: string } | undefined =
    useMemo(() => {
      if (selection?.type !== 'action') return undefined
      const envs = capabilities.data?.data.environments ?? []
      for (const env of envs) {
        const found = env.actions.find((a) => a.action_oid === selection.action_oid)
        if (found) return { action: found, environmentOid: env.environment_oid }
      }
      return undefined
    }, [selection, capabilities.data])

  const action = actionWithEnv?.action

  const [values, setValues] = useState<Record<string, string>>({})
  const [simMode, setSimMode] = useState(false)

  // Reset form values only when the *selected* action changes (by OID), not when its
  // object identity changes due to a capabilities refetch. Follow-up #4 from Plan 4-03 review.
  useEffect(() => {
    if (!action) return
    const initial: Record<string, string> = {}
    for (const param of action.input_parameters) {
      initial[param.name] = defaultValueAsString(param)
    }
    setValues(initial)
    setSimMode(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action?.action_oid])

  if (!action) return null

  const handleChange = (name: string) => (e: ChangeEvent<HTMLInputElement>) => {
    setValues((prev) => ({ ...prev, [name]: e.target.value }))
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    invoke.mutate({
      action_oid: action.action_oid,
      environment_oid: actionWithEnv!.environmentOid,
      input_parameters: action.input_parameters.map((p) => ({
        name: p.name,
        value: values[p.name] ?? '',
      })),
      ...(simMode && {
        action_property_overrides: { SIMULATION_MODE: { Value: 'true' } },
      }),
    })
  }

  const submitDisabled = invoke.isPending

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h2 className={styles.title}>{action.local_id}</h2>
        <Pill variant={action.visibility === 'observable' ? 'accent' : 'muted'}>
          {action.visibility}
        </Pill>
      </div>
      {action.description && <p className={styles.description}>{action.description}</p>}

      <form onSubmit={handleSubmit} className={styles.form}>
        {action.input_parameters.length === 0 && (
          <p className={styles.muted}>No input parameters.</p>
        )}
        {action.input_parameters.map((param) => (
          <TextInput
            key={param.name}
            label={param.name}
            value={values[param.name] ?? ''}
            onChange={handleChange(param.name)}
            {...(param.description ? { helper: param.description } : {})}
          />
        ))}
        <div className={styles.simToggleRow}>
          <label className={styles.simToggleLabel}>
            <input
              type="checkbox"
              checked={simMode}
              onChange={(e) => setSimMode(e.target.checked)}
            />
            Simulate failures
          </label>
          <span className={styles.simToggleHelper}>
            Sets SIMULATION_MODE.Value=true for this run only.
          </span>
        </div>
        <div className={styles.actions}>
          <Button type="submit" variant="primary" disabled={submitDisabled}>
            {invoke.isPending ? 'Invoking…' : 'Invoke'}
          </Button>
        </div>
      </form>

      {invoke.isError && (
        <p className={styles.error}>
          Invoke failed: {invoke.error?.message ?? 'unknown error'}
        </p>
      )}
    </div>
  )
}
