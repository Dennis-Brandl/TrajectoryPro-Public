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

export interface ReturnConfig {
  command: 'ABANDON' | 'RESTART' | 'GOTO' | 'RETRY' | 'COMPLETE'
  restart_mode?: 'CLEAN' | 'KEEP'
  goto_step_oid?: string
}

interface Props {
  value: ReturnConfig | undefined
  onChange: (rc: ReturnConfig) => void
  gotoTargets: Array<{ id: string; label: string }>
  hideHeading?: boolean
}

export function ReturnConfigEditor({ value, onChange, gotoTargets, hideHeading = false }: Props) {
  const command = value?.command ?? 'ABANDON'

  const pickCommand = (cmd: ReturnConfig['command']) => {
    if (cmd === 'RESTART') {
      onChange({ command: 'RESTART', restart_mode: value?.command === 'RESTART' ? value.restart_mode : undefined })
    } else if (cmd === 'GOTO') {
      if (gotoTargets.length === 0) return
      onChange({
        command: 'GOTO',
        goto_step_oid: value?.command === 'GOTO' ? value.goto_step_oid : gotoTargets[0]?.id,
      })
    } else {
      onChange({ command: cmd })
    }
  }

  return (
    <section className={hideHeading ? '' : 'mt-3 border-t pt-3'}>
      {!hideHeading && <h4 className="text-xs font-semibold text-muted-foreground">RETURN command</h4>}
      <select
        aria-label="RETURN command"
        value={command}
        onChange={(e) => pickCommand(e.target.value as ReturnConfig['command'])}
        className="mt-1 rounded border px-2 py-0.5 text-xs"
      >
        <option value="ABANDON">ABANDON</option>
        <option value="RESTART">RESTART</option>
        <option value="GOTO" disabled={gotoTargets.length === 0}>
          GOTO
        </option>
        <option value="RETRY">RETRY</option>
        <option value="COMPLETE">COMPLETE</option>
      </select>

      {command === 'RESTART' && (
        <label className="ml-2 text-xs">
          restart mode
          <select
            aria-label="restart mode"
            value={value?.restart_mode ?? ''}
            onChange={(e) => onChange({ command: 'RESTART', restart_mode: e.target.value as 'CLEAN' | 'KEEP' })}
            className="ml-1 rounded border px-2 py-0.5 text-xs"
          >
            <option value="" disabled>
              —
            </option>
            <option value="CLEAN">CLEAN</option>
            <option value="KEEP">KEEP</option>
          </select>
        </label>
      )}

      {command === 'GOTO' && (
        <label className="ml-2 text-xs">
          go to
          <select
            aria-label="goto target"
            value={value?.goto_step_oid ?? ''}
            onChange={(e) => onChange({ command: 'GOTO', goto_step_oid: e.target.value })}
            className="ml-1 rounded border px-2 py-0.5 text-xs"
          >
            <option value="" disabled>
              —
            </option>
            {gotoTargets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      )}
    </section>
  )
}
