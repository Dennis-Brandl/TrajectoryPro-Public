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

import { useCallback, useState } from 'react'
import styles from './EnvirXUploader.module.css'

interface EnvirXUploaderProps {
  serverUri: string
  apiKey?: string
  onUploaded: () => void
}

export function EnvirXUploader({ serverUri, apiKey, onUploaded }: EnvirXUploaderProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const handleFile = useCallback(
    async (file: File) => {
      setBusy(true)
      setError(null)
      setSuccess(null)
      try {
        const form = new FormData()
        form.append('files', file)
        const base = serverUri.replace(/\/+$/, '')
        const resp = await fetch(`${base}/management/v1/upload`, {
          method: 'POST',
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
          body: form,
        })
        if (!resp.ok) {
          const body = await resp.json().catch(() => ({}))
          throw new Error(
            (body as { error?: { message?: string } })?.error?.message ??
              `Upload failed: ${resp.status}`
          )
        }
        setSuccess(`${file.name} uploaded successfully.`)
        onUploaded()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    [serverUri, apiKey, onUploaded]
  )

  return (
    <div className={styles.uploader}>
      <label className={styles.label}>
        <span className={styles.labelText}>{busy ? 'Uploading…' : 'Upload environment'}</span>
        <input
          type="file"
          accept=".WFenvirX,.WFenvirLibX,.WFenvirBundleX,.WFactionLibX,.WFenvir,.WFaction"
          disabled={busy}
          className={styles.fileInput}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) {
              // Reset the input value so the same file can be re-uploaded
              e.target.value = ''
              void handleFile(f)
            }
          }}
        />
      </label>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {success && (
        <p role="status" className={styles.success}>
          {success}
        </p>
      )}
    </div>
  )
}
