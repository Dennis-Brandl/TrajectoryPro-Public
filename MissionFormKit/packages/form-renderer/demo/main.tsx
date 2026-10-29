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
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { kitchenSinkDocument, type FormEvent, type FormValues } from '@mission/form-schema'
import { FormDocumentView } from '@mission/form-renderer'
import '@mission/form-tokens/css/light'
import '@mission/form-renderer/layout.css'
import '@mission/form-renderer/controls.css'

const WIDTHS = [380, 768, 1440] as const

function Demo() {
  const [width, setWidth] = useState<(typeof WIDTHS)[number]>(1440)
  const [mode, setMode] = useState<'run' | 'edit'>('run')
  const [values, setValues] = useState<FormValues>({})
  const [log, setLog] = useState<string[]>([])

  const onEvent = (e: FormEvent) => {
    setLog((l) => [JSON.stringify(e), ...l].slice(0, 30))
    if (e.kind === 'fieldChange') setValues((v) => ({ ...v, [e.fieldName]: e.value }))
  }

  return (
    <div style={{ display: 'flex', gap: 16, padding: 16, fontFamily: 'system-ui' }}>
      <div>
        <p>
          {WIDTHS.map((w) => (
            <button key={w} onClick={() => setWidth(w)} disabled={w === width}>
              {w}px
            </button>
          ))}
          <button onClick={() => setMode(mode === 'run' ? 'edit' : 'run')}>mode: {mode}</button>
        </p>
        <div style={{ width, height: 700, border: '2px solid #888', resize: 'horizontal', overflow: 'hidden' }}>
          <FormDocumentView document={kitchenSinkDocument} mode={mode} values={values} onEvent={onEvent} />
        </div>
      </div>
      <pre style={{ fontSize: 11, maxWidth: 420, overflow: 'auto' }}>{log.join('\n')}</pre>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Demo />
  </StrictMode>,
)
