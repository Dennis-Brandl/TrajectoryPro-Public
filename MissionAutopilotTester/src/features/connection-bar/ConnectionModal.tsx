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

import { useId, useState, type FormEvent } from 'react'
import { Button } from '../../components/Button'
import { Modal } from '../../components/Modal'
import { TextInput } from '../../components/TextInput'
import { useConnections } from '../../store/connections'
import styles from './ConnectionModal.module.css'

export interface ConnectionModalProps {
  open: boolean
  onClose: () => void
  editingId?: string
}

// The Pro compose stack publishes the Mission Actions server on this
// address by default, so a brand-new connection form starts pointed at
// it instead of at an empty field. A previously-saved connection's own
// URL always takes precedence over this default.
export const DEFAULT_MISSION_ACTIONS_URL = 'http://127.0.0.1:3002'

function validateUrl(value: string): string | undefined {
  if (!value.trim()) return 'URL is required'
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return 'URL must be a valid http(s) URL'
    }
  } catch {
    return 'URL must be a valid http(s) URL'
  }
  return undefined
}

export function ConnectionModal({ open, onClose, editingId }: ConnectionModalProps) {
  const { state, addConnection, updateConnection } = useConnections()
  const existing = editingId ? state.connections.find((c) => c.id === editingId) : null

  const [url, setUrl] = useState(existing?.url ?? DEFAULT_MISSION_ACTIONS_URL)
  const [name, setName] = useState(existing?.name ?? '')
  const [apiKey, setApiKey] = useState(existing?.apiKey ?? '')
  const [submitted, setSubmitted] = useState(false)

  const urlError = submitted ? validateUrl(url) : undefined
  const isAddMode = !existing
  const titleId = useId()

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitted(true)
    const error = validateUrl(url)
    if (error) return
    const trimmedUrl = url.trim()
    const trimmedName = name.trim()
    const trimmedKey = apiKey.trim()
    if (existing) {
      updateConnection(existing.id, {
        url: trimmedUrl,
        name: trimmedName || undefined,
        apiKey: trimmedKey || undefined,
      })
    } else {
      addConnection({
        url: trimmedUrl,
        ...(trimmedName ? { name: trimmedName } : {}),
        ...(trimmedKey ? { apiKey: trimmedKey } : {}),
      })
    }
    onClose()
  }

  const saveDisabled = url.trim().length === 0

  return (
    <Modal open={open} onClose={onClose} titleId={titleId}>
      <form onSubmit={handleSubmit} className={styles.form}>
        <h2 id={titleId} className={styles.title}>
          {isAddMode ? 'Add connection' : 'Edit connection'}
        </h2>
        <TextInput
          label="Server URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="http://localhost:3002"
          helper="Base URL of the action server's REST endpoint."
          {...(urlError ? { error: urlError } : {})}
          autoFocus
        />
        <TextInput
          label="Name (optional)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Local dev"
        />
        <TextInput
          label="API key or token (optional)"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          helper="Sent as 'Authorization: Bearer <key>' if provided. For Mission Autopilot, enter ACTIONS_API_KEY; for the Mission Broker, MISSION_BROKER_TOKEN."
        />
        <div className={styles.actions}>
          <Button onClick={onClose} variant="secondary">
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saveDisabled}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  )
}
